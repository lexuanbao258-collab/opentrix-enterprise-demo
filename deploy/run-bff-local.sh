#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
# Runs the built BFF (which also serves web/dist) against the local Platform demo stack, in the foreground.
#   npm --prefix bff run build && npm --prefix web run build && deploy/run-bff-local.sh
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$HERE/env.sh"
exec node "$ROOT/bff/dist/main.js"
