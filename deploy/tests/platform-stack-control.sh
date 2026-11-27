#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
shim="$root/.local/m61-control-bin"
mkdir -p "$shim"
cat > "$shim/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
while (($#)); do
  case "$1" in
    stop|run|start|restart)
      printf '%s\n' "$*" >> "$M61_TRACE"
      case "$M61_MODE:$1" in
        reject:run) exit 17 ;;
        unready:start) exit 18 ;;
        blocked:stop) exit 19 ;;
      esac
      exit 0 ;;
  esac
  shift
done
exit 99
SH
chmod +x "$shim/docker"
export PATH="$shim:$PATH"
export ESM_STACK_PROJECT=opentrix-esm-m61-control
export PLATFORM_DIR="$shim"
export M61_TRACE="$root/.local/m61-control.trace"
export M61_MODE
runs=0
probe() {
  local mode=$1 expected_code=$2 expected_trace=$3 out rc
  export M61_MODE="$mode"
  : > "$M61_TRACE"
  set +e
  out=$(bash "$root/deploy/platform-stack.sh" migrate 2>&1)
  rc=$?
  set -e
  if [[ "$rc" != "$expected_code" || "$(cat "$M61_TRACE")" != "$expected_trace" ]]; then
    printf 'FAIL %s rc=%s\n%s\n%s\n' "$mode" "$rc" "$out" "$(cat "$M61_TRACE")"
    exit 1
  fi
  if [[ "$mode" == reject || "$mode" == unready ]]; then
    [[ "$out" == *"Backend remains stopped"* ]] || exit 1
  fi
  printf 'PASS %s\n' "$mode"
  ((runs+=1))
}
steps=$'stop backend\nrun --rm --no-deps platform-migrate'
await_keycloak="$steps"$'\nstart --wait --wait-timeout 180 keycloak'
probe success 0 "$await_keycloak"$'\nrestart --no-deps backend'
probe reject 17 "$steps"
probe unready 1 "$await_keycloak"
probe blocked 19 "stop backend"
printf 'PASS %s / FAIL 0 / SKIP 0 shell-control scenarios\n' "$runs"
