<!--
SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
SPDX-License-Identifier: Apache-2.0
-->

# Developer setup and deployment

## 1. What ESM needs from the Platform

ESM calls the Platform only through the published contract (`docs/api/openapi-v1.json` in the Platform repository,
baseline `f401b6e79930a1386e71e92a91ae6a909cfa1e59`). It needs:

1. A Platform deployment with `it-helpdesk` **1.1.0** and `hr-leave` **1.1.0** registered (`manifests/*/app.json`;
   `hr-leave` is the Platform baseline's manifest, unmodified).
2. An OIDC provider whose access tokens carry audience `tricore-api` and the client roles
   `it-helpdesk:requester|agent|admin` and `hr-leave:employee|manager|auditor` in `resource_access.tricore-api.roles`
   (Keycloak realm `tricore` in the demo; the HR roles already exist in the realm).
3. A Keycloak client for the ESM BFF (`deploy/keycloak/provision-esm.sh` creates `esm-bff`: confidential,
   Authorization Code + PKCE S256, no direct grants, full scope off, role scope limited to the six IT and HR roles).

Adding another ESM module means: its manifest under `manifests/`, its roles in the client's role scope, one entry in
`ALLOWED_APPS` (`bff/src/routes.ts`: entities and transitions), and its pages under `web/src/pages`. No Platform change.

ESM never reads the Platform database. The only database access in this repository is `deploy/db-snapshot.sh`, an
**operator evidence script** that is not part of the application.

## 2. Local stack

```bash
# From the pinned ESM checkout in the README, clone the Platform beside it.
git clone --no-checkout https://github.com/lexuanbao258-collab/opentrix-v1-candidate.git ../opentrix-v1-candidate
git -C ../opentrix-v1-candidate checkout --detach 179d61d31069ce1a1bf246f35722d3a66cad0a93
export PLATFORM_DIR="$PWD/../opentrix-v1-candidate"    # frozen runtime f401b6e
. deploy/settings.sh
deploy/platform-stack.sh up        # project "opentrix-esm": postgres, keycloak, backend, ingress. Portal/Portal BFF are NOT started
deploy/provision-keycloak.sh       # generates .local/esm.env (git-ignored) and registers client + demo users
docker cp "$ESM_STACK_PROJECT-ingress-1:/data/caddy/pki/authorities/local/root.crt" "$ESM_LOCAL_DIR/caddy-root.crt"
```

`platform-stack.sh` only touches Compose project `${ESM_STACK_PROJECT:-opentrix-esm}`:

| Command | Effect |
| --- | --- |
| `up` | build/start, register manifests from `ESM_MANIFEST_DIR` (default `manifests/`) |
| `migrate` | stop the backend, run registration as the Platform schema owner, wait for Keycloak and start the backend after success |
| `down` | stop containers, **keep volumes** |
| `reset` | delete **only this project's** volumes (explicit and destructive; never run automatically) |

Use a different `ESM_STACK_PROJECT` and unused loopback ports to run beside the default demo.
Set variables consistently for provisioning, running the BFF and Playwright. A non-default project stores credentials,
its CA and Playwright artifacts under `.local/<project>/`.

| Setting | Default |
| --- | --- |
| `ESM_PLATFORM_HTTPS_PORT` | `8443` (Platform ingress host port) |
| `ESM_KEYCLOAK_PORT` | `8180` (Keycloak HTTP port inside the shared namespace and on the host) |
| `ESM_PORT` | `5174` (BFF listen port) |
| `PLATFORM_API_URL` | `https://localhost:$ESM_PLATFORM_HTTPS_PORT` |
| `OIDC_ISSUER` | `http://localhost:$ESM_KEYCLOAK_PORT/realms/tricore`; reachable by both the client and Platform |
| `ESM_BFF_URL` | `ESM_PUBLIC_ORIGIN`, if set, or `http://localhost:$ESM_PORT` |
| `OIDC_REDIRECT_URI` | `$ESM_BFF_URL/bff/callback`; keep the same hostname and scheme and route to the same BFF |
| `E2E_BASE_URL`, `E2E_PLATFORM_URL` | BFF and Platform URLs above; optional Playwright overrides |

Export `NODE_EXTRA_CA_CERTS` with the project CA or source `deploy/env.sh` before starting the BFF and Playwright.
Keycloak runs in `start-dev` with state inside its container: if the container is *recreated*, run
`deploy/provision-keycloak.sh` again (idempotent). PostgreSQL data lives in a named volume and survives.

### Run ESM

```bash
(cd bff && npm ci && npm run build)
(cd web && npm ci && npm run build)
deploy/run-bff-local.sh            # BFF + built SPA on http://localhost:5174
# development: (cd bff && npm run dev) and (cd web && npm run dev)  -> Vite proxies /bff to 127.0.0.1:5174
```

Demo users (passwords are random, in `.local/esm.env`):

| User | Roles | Use |
| --- | --- | --- |
| `esm-requester1`, `esm-requester2` | it-helpdesk:requester | IT only |
| `esm-agent`, `esm-admin` | it-helpdesk:agent / admin | IT only |
| `esm-employee1`, `esm-employee2` | hr-leave:employee | HR only |
| `esm-manager` | hr-leave:manager | HR only; approves/rejects |
| `esm-auditor` | hr-leave:auditor | HR only; reads the audit trail |
| `esm-dual` | it-helpdesk:requester + hr-leave:employee + hr-leave:manager | both modules; cannot approve own leave request |

`deploy/provision-keycloak.sh` is idempotent and appends the HR passwords to an existing `.local/esm.env` without
touching existing secrets.

How the SPA decides what to show: it calls `GET /bff/api/v1/apps` (Platform discovery: only applications in which the
caller holds a role), then per application `GET app` / `GET entity` (`allowedOperations`) and, per record,
`GET workflow` (`allowedActions`). The signed-in user's Platform actor id (`oidc:b64url(iss).b64url(sub)`, as documented in the Platform [API guide](https://github.com/lexuanbao258-collab/opentrix-v1-candidate/blob/621c32999668203f40363009aabe83ec66287c37/docs/candidate/API-GUIDE.md)) is returned by `/bff/session` so the UI can tell which records a user created.

## 3. Manifest upgrade (1.0.0 -> 1.1.0) and rules

The Platform registers immutable manifest versions. A new version must be a higher SemVer and **compatible**:

* keep every role and entity; keep every existing field definition and the `required` list unchanged;
* never broaden a grant (new role/operation grants and `own`->`all` are refused), never drop `sensitive`, `notByCreator`
  or a locked state; keep an existing workflow's states and transitions identical;
* additions are allowed: new entities (with their own workflow/permissions), new optional fields on new entities.

```bash
ESM_MANIFEST_DIR=$PWD/manifests deploy/platform-stack.sh migrate      # existing data is untouched
deploy/check-incompatible-upgrades.sh                                  # shows unsafe 1.2.0 variants being refused
deploy/db-snapshot.sh                                                  # operator evidence: row fingerprints before/after
```

The backend caches manifests for its lifetime. During `migrate`, it is stopped before registration starts. Registration
failure exits with an explicit message and leaves the backend stopped. Check the error, correct the manifest directory,
and run `migrate` again to restore service. The negative upgrade helper leaves the backend stopped after rejected attempts.
Use the previously active manifests when restoring a rejected deployment. Serialize operator deploy and restart commands
for a given project.

## 4. How ESM handles failures

| Situation | Behavior |
| --- | --- |
| 401 / session ended | BFF drops the session; SPA shows a sign-in dialog over the page (no data loss on screen); SSO returns the user |
| 403 | message "no permission"; the UI never relies on this - controls come from `allowedOperations` and `allowedActions` |
| 409 `VERSION_CONFLICT` / `STATE_LOCKED` / `TRANSITION_NOT_ALLOWED` | message + **Reload**; nothing is retried |
| 400 `VALIDATION_FAILED` | errors attached to fields by JSON pointer (`/title`) |
| 503 `COMMIT_OUTCOME_UNKNOWN`, a lost connection, or HTTP 500/502/504 of uncertain origin on a write | amber banner; form locked; **Check status** reads the record; only after proof of absence is **Retry with the same request id** offered (create uses a client UUID so the Platform deduplicates) |

The BFF never retries a write. Reads that fail show an error with a Retry button.

## 5. Production notes (not done in this candidate)

* Use HTTPS for `ESM_PUBLIC_ORIGIN` (cookies become `Secure`, HSTS is sent) and a real CA for the Platform ingress.
* The session store is in memory (single BFF instance, sessions lost on restart). Use a shared store to scale out.
* Add rate limiting and monitoring in front of the BFF; rotate `OIDC_CLIENT_SECRET`.
* Replace demo users and the Keycloak dev mode.

## 6. Demonstration data (M6.2)

`e2e/scripts/seed-demo.ts` writes a small, curated, fictional Vietnamese dataset (5 service categories, 16 IT tickets and
10 leave requests across every supported state) **through the public API** with the demo identities. It never touches
the database and uses stable ids, so re-running it is idempotent. Run it only against a **separate, disposable** stack, never
the one used for regression tests (those records are fixtures, not product data):

```bash
# a separate project and ports, e.g. ESM_STACK_PROJECT=opentrix-esm-demo ESM_PLATFORM_HTTPS_PORT=18844 ESM_KEYCLOAK_PORT=18880 ESM_PORT=18874
deploy/platform-stack.sh up && deploy/provision-keycloak.sh      # then start the BFF (deploy/run-bff-local.sh)
(cd e2e && npx playwright test --project=setup && npx tsx scripts/seed-demo.ts)
(cd e2e && npx tsx scripts/shots-m62.ts after)                   # representative desktop + mobile screenshots
```
