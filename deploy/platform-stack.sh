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
ROOT="$(dirname "$HERE")"
: "${PLATFORM_DIR:?set PLATFORM_DIR to the Platform checkout}"
: "${ESM_MANIFEST_DIR:=$ROOT/manifests}"
export ESM_MANIFEST_DIR
PROJECT="${ESM_STACK_PROJECT:-opentrix-esm}"
ENV_FILE="$ROOT/.local/platform.env"
mkdir -p "$ROOT/.local"
C="docker compose -p $PROJECT --project-directory $PLATFORM_DIR/infra --env-file $ENV_FILE -f $PLATFORM_DIR/infra/compose.demo.yml -f $HERE/compose.esm.yml"

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
    $C up -d --build backend ingress
    ;;
  migrate)
    $C rm -f platform-migrate
    $C up --no-deps platform-migrate
    $C restart backend
    ;;
  down)
    $C stop backend ingress keycloak postgres
    ;;
  reset)
    $C down -v --remove-orphans
    ;;
  *) echo "usage: $0 up|migrate|down|reset" >&2; exit 2;;
esac
