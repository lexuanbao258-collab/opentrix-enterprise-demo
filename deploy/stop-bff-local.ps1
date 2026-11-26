# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
# Stops the local BFF process listening on the ESM port (default 5174).
$port = if ($env:ESM_PORT) { [int]$env:ESM_PORT } else { 5174 }
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
