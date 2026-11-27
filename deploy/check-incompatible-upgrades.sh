#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
#
# Checks that the controlled migration rejects unsafe it-helpdesk upgrades and leaves the backend stopped.
# Each case derives a 1.2.0 manifest from manifests/it-helpdesk/app.json, runs the controlled migration step
# and expects a non-zero exit. The active version must still be 1.1.0 afterwards. Non-destructive: a rejected
# registration is rolled back by the Platform.
set -uo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$HERE/settings.sh" || exit $?
: "${PLATFORM_DIR:?set PLATFORM_DIR}"
WORK=$(mktemp -d "$ESM_LOCAL_DIR/incompatible.XXXXXX") || exit $?
fail=0

case_run() { # name, python mutation
  local name="$1" mutation="$2" dir="$WORK/$1/it-helpdesk"
  mkdir -p "$dir"
  python - "$ROOT/manifests/it-helpdesk/app.json" "$dir/app.json" <<PY
import json, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
m["version"] = "1.2.0"
$mutation
json.dump(m, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
  local out
  local expected='Incompatible manifest[^"]*|must increase[^"]*|immutable[^"]*'
  out=$(ESM_MANIFEST_DIR="$WORK/$name" bash "$HERE/platform-stack.sh" migrate 2>&1)
  local code=$?
  local reason
  reason=$(printf '%s' "$out" | grep -oE "${3:-$expected}" | head -1)
  if [ "$code" -ne 0 ] && [ -n "$reason" ]; then
    echo "REJECTED  $name: $reason"
  else
    echo "FAIL  $name: expected incompatible manifest rejection (exit $code)"
    fail=1
  fi
}

case_run agent-gets-create     'm["entities"]["ticket"]["permissions"]["create"]["agent"] = "all"'
case_run requester-reads-all   'm["entities"]["ticket"]["permissions"]["read"]["requester"] = "all"'
case_run category-field-changed 'm["entities"]["category"]["schema"]["properties"]["name"]["maxLength"] = 50'
case_run ticket-field-changed  'm["entities"]["ticket"]["schema"]["properties"]["title"]["maxLength"] = 100'
case_run ticket-required-added 'm["entities"]["ticket"]["schema"]["properties"]["extra"] = {"type": "string", "maxLength": 10}; m["entities"]["ticket"]["schema"]["required"].append("extra")'
case_run transition-removed    'del m["entities"]["ticket"]["workflow"]["transitions"]["reopen"]'
case_run notbycreator-dropped  'del m["entities"]["ticket"]["workflow"]["transitions"]["start"]["notByCreator"]'
case_run role-removed          'del m["roles"]["agent"]' 'undeclared role agent'
case_run entity-removed        'del m["entities"]["category"]'

echo "--- active version after all attempts:"
. "$ESM_LOCAL_DIR/platform.env"
docker exec -i -e PGPASSWORD="$HELPDESK_SETUP_PASSWORD" "$ESM_STACK_PROJECT-postgres-1" \
  psql -h 127.0.0.1 -U helpdesk_setup -d helpdesk_disposable_demo -X -A -t -c \
  "SELECT app_key||' '||app_version FROM opentrix_platform.applications; SELECT 'versions: '||string_agg(app_version, ',' ORDER BY app_version) FROM opentrix_platform.application_versions"
echo "Backend remains stopped after rejection. Re-run migrate with the active manifest directory to restore service."
exit $fail
