# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
# Source this file to load ESM settings and its project-local client credentials.
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/settings.sh" || return
set -a
. "$ESM_LOCAL_DIR/esm.env"
set +a
export ESM_PUBLIC_ORIGIN="$ESM_BFF_URL"
export ESM_STATIC_DIR="${ESM_STATIC_DIR:-$ROOT/web/dist}"
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$ESM_LOCAL_DIR/caddy-root.crt}"
