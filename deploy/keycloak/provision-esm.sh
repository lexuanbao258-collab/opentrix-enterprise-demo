#!/bin/bash
# SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
# SPDX-License-Identifier: Apache-2.0
#
# Registers the ESM browser client and demo users in an existing Keycloak realm (default: tricore).
# Idempotent. Runs INSIDE the Keycloak container (it needs kcadm.sh), e.g. via deploy/provision-keycloak.sh.
#
# Required environment:
#   KEYCLOAK_ADMIN_PASSWORD, ESM_PUBLIC_ORIGIN, OIDC_CLIENT_SECRET,
#   ESM_PASSWORD_REQUESTER1, ESM_PASSWORD_REQUESTER2, ESM_PASSWORD_AGENT, ESM_PASSWORD_ADMIN,
#   ESM_PASSWORD_EMPLOYEE1, ESM_PASSWORD_EMPLOYEE2, ESM_PASSWORD_MANAGER, ESM_PASSWORD_AUDITOR, ESM_PASSWORD_DUAL
# Optional: REALM (tricore), KC_SERVER (http://localhost:8180), API_CLIENT (tricore-api), CLIENT_ID (esm-bff)
set -euo pipefail
KC=/opt/keycloak/bin/kcadm.sh
CFG=/tmp/esm-kcadm.config
REALM="${REALM:-tricore}"
SERVER="${KC_SERVER:-http://localhost:8180}"
API="${API_CLIENT:-tricore-api}"
CLIENT="${CLIENT_ID:-esm-bff}"
trap 'rm -f "$CFG"' EXIT

$KC config credentials --config "$CFG" --server "$SERVER" --realm master --user admin --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null
id_of() { $KC get clients -r "$REALM" --config "$CFG" -q "clientId=$1" --fields id --format csv --noquotes; }

CID=$(id_of "$CLIENT")
if [ -z "$CID" ]; then
  $KC create clients -r "$REALM" --config "$CFG" -f - <<JSON >/dev/null
{
  "clientId": "$CLIENT",
  "name": "OpenTrix ESM (browser sign-in through the ESM BFF)",
  "enabled": true,
  "protocol": "openid-connect",
  "publicClient": false,
  "clientAuthenticatorType": "client-secret",
  "standardFlowEnabled": true,
  "implicitFlowEnabled": false,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": false,
  "fullScopeAllowed": false,
  "redirectUris": ["$ESM_PUBLIC_ORIGIN/bff/callback"],
  "webOrigins": [],
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": "$ESM_PUBLIC_ORIGIN/",
    "client.session.idle.timeout": "1800"
  }
}
JSON
  CID=$(id_of "$CLIENT")
  $KC create "clients/$CID/protocol-mappers/models" -r "$REALM" --config "$CFG" -f - <<JSON >/dev/null
{
  "name": "audience-$API",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-audience-mapper",
  "consentRequired": false,
  "config": {
    "included.client.audience": "$API",
    "access.token.claim": "true",
    "id.token.claim": "false",
    "introspection.token.claim": "true"
  }
}
JSON
  echo "client $CLIENT: created"
else
  echo "client $CLIENT: exists"
fi
$KC update "clients/$CID" -r "$REALM" --config "$CFG" -s "secret=$OIDC_CLIENT_SECRET" \
  -s "redirectUris=[\"$ESM_PUBLIC_ORIGIN/bff/callback\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=$ESM_PUBLIC_ORIGIN/" >/dev/null

# The client may only ever carry the it-helpdesk and hr-leave roles of the resource client (full scope is off).
API_ID=$(id_of "$API")
ROLES="["
for role in it-helpdesk:admin it-helpdesk:agent it-helpdesk:requester hr-leave:employee hr-leave:manager hr-leave:auditor; do
  rid=$($KC get "clients/$API_ID/roles/$role" -r "$REALM" --config "$CFG" --fields id --format csv --noquotes)
  ROLES="$ROLES{\"id\":\"$rid\",\"name\":\"$role\"},"
done
ROLES="${ROLES%,}]"
$KC create "clients/$CID/scope-mappings/clients/$API_ID" -r "$REALM" --config "$CFG" -b "$ROLES" >/dev/null 2>&1 || true

make_user() { # username first last password role...   (role = full name, e.g. it-helpdesk:agent)
  local u="$1" first="$2" last="$3" pw="$4"; shift 4
  if [ -z "$($KC get users -r "$REALM" --config "$CFG" -q "username=$u" --fields id --format csv --noquotes)" ]; then
    $KC create users -r "$REALM" --config "$CFG" -s "username=$u" -s enabled=true -s emailVerified=true       -s "firstName=$first" -s "lastName=$last" -s "email=$u@esm.example.test" >/dev/null
  fi
  $KC set-password -r "$REALM" --config "$CFG" --username "$u" --new-password "$pw"
  for role in "$@"; do
    $KC add-roles -r "$REALM" --config "$CFG" --uusername "$u" --cclientid "$API" --rolename "$role" >/dev/null 2>&1 || true
  done
  echo "user $u: ready ($*)"
}
# IT Helpdesk (M3)
make_user esm-requester1 "Trần" "Minh Khoa" "$ESM_PASSWORD_REQUESTER1" it-helpdesk:requester
make_user esm-requester2 "Lê" "Thu Hà" "$ESM_PASSWORD_REQUESTER2" it-helpdesk:requester
make_user esm-agent "Phạm" "Quốc Bảo" "$ESM_PASSWORD_AGENT" it-helpdesk:agent
make_user esm-admin "Nguyễn" "Thanh Mai" "$ESM_PASSWORD_ADMIN" it-helpdesk:admin
# HR Leave (M4): HR roles only, no IT role
make_user esm-employee1 "Vũ" "Hoàng Nam" "$ESM_PASSWORD_EMPLOYEE1" hr-leave:employee
make_user esm-employee2 "Đặng" "Ngọc Lan" "$ESM_PASSWORD_EMPLOYEE2" hr-leave:employee
make_user esm-manager "Bùi" "Văn Hùng" "$ESM_PASSWORD_MANAGER" hr-leave:manager
make_user esm-auditor "Hoàng" "Kim Oanh" "$ESM_PASSWORD_AUDITOR" hr-leave:auditor
# Holds roles in BOTH applications, and is employee AND manager in HR Leave (cannot approve their own requests)
make_user esm-dual "Ngô" "Thanh Sơn" "$ESM_PASSWORD_DUAL" it-helpdesk:requester hr-leave:employee hr-leave:manager
echo "provision-esm OK"
