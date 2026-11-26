#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
#
# Generates ESM secrets once (.local/esm.env, ignored by Git) and registers the ESM client and demo users in the
# Keycloak container of the Platform demo stack.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(dirname "$HERE")"
PROJECT="${ESM_STACK_PROJECT:-opentrix-esm}"
ESM_ENV="$ROOT/.local/esm.env"
mkdir -p "$ROOT/.local"
if [ ! -f "$ESM_ENV" ]; then
  umask 077
  r() { openssl rand -hex 16; }
  cat > "$ESM_ENV" <<ENV
ESM_PUBLIC_ORIGIN=${ESM_PUBLIC_ORIGIN:-http://localhost:5174}
OIDC_CLIENT_SECRET=$(r)
ESM_PASSWORD_REQUESTER1=$(r)
ESM_PASSWORD_REQUESTER2=$(r)
ESM_PASSWORD_AGENT=$(r)
ESM_PASSWORD_ADMIN=$(r)
ENV
fi
set -a; . "$ESM_ENV"; . "$ROOT/.local/platform.env"; set +a
docker exec -i \
  -e KEYCLOAK_ADMIN_PASSWORD -e ESM_PUBLIC_ORIGIN -e OIDC_CLIENT_SECRET \
  -e ESM_PASSWORD_REQUESTER1 -e ESM_PASSWORD_REQUESTER2 -e ESM_PASSWORD_AGENT -e ESM_PASSWORD_ADMIN \
  "$PROJECT-keycloak-1" bash -s < "$HERE/keycloak/provision-esm.sh"
