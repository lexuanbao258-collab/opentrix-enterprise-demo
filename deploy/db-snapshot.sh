#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
# Read-only operator evidence (NOT used by the ESM application): fingerprints Platform rows for upgrade checks.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
. "$HERE/settings.sh"
. "$ESM_LOCAL_DIR/platform.env"
docker exec -i -e PGPASSWORD="$HELPDESK_SETUP_PASSWORD" "$ESM_STACK_PROJECT-postgres-1" \
  psql -h 127.0.0.1 -U helpdesk_setup -d helpdesk_disposable_demo -X -A -t -F '|' -v ON_ERROR_STOP=1 <<'SQL'
\echo -- applications (app_key|version|sha256-prefix)
SELECT app_key, app_version, left(manifest_sha256, 12) FROM opentrix_platform.applications ORDER BY 1;
\echo -- application_versions
SELECT app_key, app_version FROM opentrix_platform.application_versions ORDER BY 1, 2;
\echo -- schema history
SELECT version, success FROM opentrix_platform.platform_schema_history WHERE version IS NOT NULL ORDER BY installed_rank;
\echo -- records per entity (count|md5 of id,version,data)
SELECT entity_key, count(*), md5(string_agg(record_id::text || ':' || version || ':' || data::text, ',' ORDER BY record_id))
  FROM opentrix_platform.records GROUP BY 1 ORDER BY 1;
\echo -- audit events per entity
SELECT entity_key, count(*) FROM opentrix_platform.audit_events GROUP BY 1 ORDER BY 1;
\echo -- entity definitions
SELECT app_key, entity_key FROM opentrix_platform.entity_definitions ORDER BY 1, 2;
SQL
