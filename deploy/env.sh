# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
# Source this file: loads ESM settings for a local run against the Platform demo stack.
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
set -a
. "$ROOT/.local/esm.env"
set +a
export ESM_PORT="${ESM_PORT:-5174}"
export OIDC_ISSUER="${OIDC_ISSUER:-http://localhost:8180/realms/tricore}"
export PLATFORM_API_URL="${PLATFORM_API_URL:-https://localhost:8443}"
export ESM_STATIC_DIR="${ESM_STATIC_DIR:-$ROOT/web/dist}"
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$ROOT/.local/caddy-root.crt}"
