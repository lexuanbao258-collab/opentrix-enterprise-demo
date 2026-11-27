#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
#
# Generates ESM secrets once (.local/esm.env, ignored by Git) and registers the ESM client and demo users in the
# Keycloak container of the Platform demo stack.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$HERE/settings.sh"
ESM_ENV="$ESM_LOCAL_DIR/esm.env"
mkdir -p "$ESM_LOCAL_DIR"
if [ ! -f "$ESM_ENV" ]; then
  umask 077
  r() { openssl rand -hex 16; }
  cat > "$ESM_ENV" <<ENV
OIDC_CLIENT_SECRET=$(r)
ESM_PASSWORD_REQUESTER1=$(r)
ESM_PASSWORD_REQUESTER2=$(r)
ESM_PASSWORD_AGENT=$(r)
ESM_PASSWORD_ADMIN=$(r)
ENV
fi
# Add variables introduced after the first run (M4) without touching existing secrets.
umask 077
for v in ESM_PASSWORD_EMPLOYEE1 ESM_PASSWORD_EMPLOYEE2 ESM_PASSWORD_MANAGER ESM_PASSWORD_AUDITOR ESM_PASSWORD_DUAL; do
  grep -q "^$v=" "$ESM_ENV" || echo "$v=$(openssl rand -hex 16)" >> "$ESM_ENV"
done
set -a; . "$ESM_ENV"; . "$ESM_LOCAL_DIR/platform.env"; set +a
export ESM_PUBLIC_ORIGIN="$ESM_BFF_URL"
docker exec -i \
  -e KEYCLOAK_ADMIN_PASSWORD -e ESM_PUBLIC_ORIGIN -e OIDC_CLIENT_SECRET -e KC_SERVER -e OIDC_REDIRECT_URI \
  -e ESM_PASSWORD_REQUESTER1 -e ESM_PASSWORD_REQUESTER2 -e ESM_PASSWORD_AGENT -e ESM_PASSWORD_ADMIN \
  -e ESM_PASSWORD_EMPLOYEE1 -e ESM_PASSWORD_EMPLOYEE2 -e ESM_PASSWORD_MANAGER -e ESM_PASSWORD_AUDITOR -e ESM_PASSWORD_DUAL \
  "$ESM_STACK_PROJECT-keycloak-1" bash -s < "$HERE/keycloak/provision-esm.sh"
