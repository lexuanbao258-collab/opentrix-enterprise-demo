# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export ESM_STACK_PROJECT="${ESM_STACK_PROJECT:-opentrix-esm}"
if [[ ! "$ESM_STACK_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "Invalid ESM_STACK_PROJECT" >&2
  return 2
fi
ESM_LOCAL_DIR="$ROOT/.local"
if [[ "$ESM_STACK_PROJECT" != opentrix-esm ]]; then
  ESM_LOCAL_DIR="$ESM_LOCAL_DIR/$ESM_STACK_PROJECT"
fi
export ESM_PLATFORM_HTTPS_PORT="${ESM_PLATFORM_HTTPS_PORT:-8443}"
export ESM_KEYCLOAK_PORT="${ESM_KEYCLOAK_PORT:-8180}"
export ESM_PORT="${ESM_PORT:-5174}"
export ESM_BFF_URL="${ESM_BFF_URL:-${ESM_PUBLIC_ORIGIN:-http://localhost:$ESM_PORT}}"
export ESM_PUBLIC_ORIGIN="$ESM_BFF_URL"
export PLATFORM_API_URL="${PLATFORM_API_URL:-https://localhost:$ESM_PLATFORM_HTTPS_PORT}"
export OIDC_ISSUER="${OIDC_ISSUER:-http://localhost:$ESM_KEYCLOAK_PORT/realms/tricore}"
if [[ "$OIDC_ISSUER" != */realms/tricore ]]; then
  echo "OIDC_ISSUER must end with /realms/tricore for the demo realm" >&2
  return 2
fi
export ESM_KEYCLOAK_URL="${OIDC_ISSUER%/realms/tricore}"
export KC_SERVER="http://localhost:$ESM_KEYCLOAK_PORT"
export OIDC_REDIRECT_URI="${OIDC_REDIRECT_URI:-$ESM_PUBLIC_ORIGIN/bff/callback}"
if [[ ! "$OIDC_REDIRECT_URI" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?/bff/callback$ ]]; then
  echo "OIDC_REDIRECT_URI must name the existing /bff/callback route" >&2
  return 2
fi
