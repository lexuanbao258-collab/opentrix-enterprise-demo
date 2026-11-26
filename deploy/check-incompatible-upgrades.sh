#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
#
# Proves the Platform registrar refuses unsafe it-helpdesk upgrades on the RUNNING stack and changes nothing.
# Each case derives a 1.2.0 manifest from manifests/it-helpdesk/app.json, runs the controlled migration step
# and expects a non-zero exit. The active version must still be 1.1.0 afterwards. Non-destructive: a rejected
# registration is rolled back by the Platform.
set -uo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(dirname "$HERE")"
: "${PLATFORM_DIR:?set PLATFORM_DIR}"
PROJECT="${ESM_STACK_PROJECT:-opentrix-esm}"
WORK="$ROOT/.local/incompatible"
rm -rf "$WORK"; mkdir -p "$WORK"
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
  out=$(ESM_STACK_PROJECT="$PROJECT" ESM_MANIFEST_DIR="$WORK/$name" docker compose -p "$PROJECT" \
      --project-directory "$PLATFORM_DIR/infra" --env-file "$ROOT/.local/platform.env" \
      -f "$PLATFORM_DIR/infra/compose.demo.yml" -f "$HERE/compose.esm.yml" \
      run --rm --no-deps platform-migrate 2>&1)
  local code=$?
  local reason
  reason=$(printf '%s' "$out" | grep -o 'Incompatible manifest[^"]*\|must increase[^"]*\|immutable[^"]*' | head -1)
  if [ "$code" -ne 0 ]; then echo "REJECTED  $name: ${reason:-non-zero exit $code}"; else echo "ACCEPTED  $name  <-- UNEXPECTED"; fail=1; fi
}

case_run agent-gets-create     'm["entities"]["ticket"]["permissions"]["create"]["agent"] = "all"'
case_run requester-reads-all   'm["entities"]["ticket"]["permissions"]["read"]["requester"] = "all"'
case_run category-field-changed 'm["entities"]["category"]["schema"]["properties"]["name"]["maxLength"] = 50'
case_run ticket-field-changed  'm["entities"]["ticket"]["schema"]["properties"]["title"]["maxLength"] = 100'
case_run ticket-required-added 'm["entities"]["ticket"]["schema"]["properties"]["extra"] = {"type": "string", "maxLength": 10}; m["entities"]["ticket"]["schema"]["required"].append("extra")'
case_run transition-removed    'del m["entities"]["ticket"]["workflow"]["transitions"]["reopen"]'
case_run notbycreator-dropped  'del m["entities"]["ticket"]["workflow"]["transitions"]["start"]["notByCreator"]'
case_run role-removed          'del m["roles"]["agent"]'
case_run entity-removed        'del m["entities"]["category"]'

echo "--- active version after all attempts:"
. "$ROOT/.local/platform.env"
docker exec -i -e PGPASSWORD="$HELPDESK_SETUP_PASSWORD" "$PROJECT-postgres-1" \
  psql -h 127.0.0.1 -U helpdesk_setup -d helpdesk_disposable_demo -X -A -t -c \
  "SELECT app_key||' '||app_version FROM opentrix_platform.applications; SELECT 'versions: '||string_agg(app_version, ',' ORDER BY app_version) FROM opentrix_platform.application_versions"
exit $fail
