#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
#
# Starts/stops the OpenTrix Platform demo stack (PostgreSQL + Keycloak + backend + HTTPS ingress) that
# ESM runs against. It never touches other Compose projects or volumes: everything lives in project
# "${ESM_STACK_PROJECT:-opentrix-esm}". The legacy Platform Portal and Portal BFF are NOT started.
#
#   PLATFORM_DIR=<checkout of the Platform baseline> ESM_MANIFEST_DIR=<dir with <app>/app.json> \
#     deploy/platform-stack.sh up|migrate|down|reset
#
# up      generate secrets once, build, start the stack, register manifests
# migrate re-run the controlled migration/registration step and restart the backend (manifest upgrade)
# down    stop containers, KEEP volumes (data survives)
# reset   stop and delete ONLY this project's volumes (explicit, destructive)
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$HERE/settings.sh"
: "${PLATFORM_DIR:?set PLATFORM_DIR to the Platform checkout}"
: "${ESM_MANIFEST_DIR:=$ROOT/manifests}"
export ESM_MANIFEST_DIR
ENV_FILE="$ESM_LOCAL_DIR/platform.env"
mkdir -p "$ESM_LOCAL_DIR"
compose=(docker compose -p "$ESM_STACK_PROJECT" --project-directory "$PLATFORM_DIR/infra" --env-file "$ENV_FILE"
  -f "$PLATFORM_DIR/infra/compose.demo.yml" -f "$HERE/compose.esm.yml")

if [ ! -f "$ENV_FILE" ]; then
  umask 077
  r() { openssl rand -hex 16; }
  cat > "$ENV_FILE" <<ENV
HELPDESK_SETUP_PASSWORD=$(r)
HELPDESK_RUNTIME_PASSWORD=$(r)
PLATFORM_OWNER_PASSWORD=$(r)
KEYCLOAK_ADMIN_PASSWORD=$(r)
PORTAL_OIDC_CLIENT_SECRET=$(r)
GATEWAY_MONITOR_CLIENT_SECRET=$(r)
EXTERNAL_EMPLOYEE_SECRET=$(r)
EXTERNAL_APPROVER_SECRET=$(r)
DEMO_EMPLOYEE_PASSWORD=$(r)
DEMO_COORDINATOR_PASSWORD=$(r)
DEMO_WORKER_PASSWORD=$(r)
ENV
fi

case "${1:-}" in
  up)
    "${compose[@]}" up -d --build backend ingress
    ;;
  migrate)
    "${compose[@]}" stop backend
    if "${compose[@]}" run --rm --no-deps platform-migrate; then
      if ! "${compose[@]}" start --wait --wait-timeout 180 keycloak; then
        echo "Manifest registered. Backend remains stopped because Keycloak is not ready." >&2
        exit 1
      fi
      "${compose[@]}" restart --no-deps backend
    else
      status=$?
      echo "Manifest registration failed (exit $status). Backend remains stopped. Correct the manifest and run migrate again." >&2
      exit "$status"
    fi
    ;;
  down)
    "${compose[@]}" stop backend ingress keycloak postgres
    ;;
  reset)
    "${compose[@]}" down -v --remove-orphans
    ;;
  *) echo "usage: $0 up|migrate|down|reset" >&2; exit 2;;
esac
