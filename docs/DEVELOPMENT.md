<!--
SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
SPDX-License-Identifier: Apache-2.0
-->

# Developer setup and deployment

## 1. What ESM needs from the Platform

ESM calls the Platform only through the published contract (`docs/api/openapi-v1.json` in the Platform repository,
baseline `f401b6e79930a1386e71e92a91ae6a909cfa1e59`). It needs:

1. A Platform deployment with `it-helpdesk` **1.1.0** registered (`manifests/it-helpdesk/app.json`).
2. An OIDC provider whose access tokens carry audience `tricore-api` and the client roles
   `it-helpdesk:requester|agent|admin` in `resource_access.tricore-api.roles` (Keycloak realm `tricore` in the demo).
3. A Keycloak client for the ESM BFF (`deploy/keycloak/provision-esm.sh` creates `esm-bff`: confidential,
   Authorization Code + PKCE S256, no direct grants, full scope off, role scope limited to the three helpdesk roles).

ESM never reads the Platform database. The only database access in this repository is `deploy/db-snapshot.sh`, an
**operator evidence script** that is not part of the application.

## 2. Local stack

```bash
export PLATFORM_DIR=/path/to/platform@f401b6e     # e.g. `git archive f401b6e | tar -x -C <dir>` - read-only use
deploy/platform-stack.sh up        # project "opentrix-esm": postgres, keycloak, backend, ingress. Portal/Portal BFF are NOT started
deploy/provision-keycloak.sh       # generates .local/esm.env (git-ignored) and registers client + demo users
docker cp opentrix-esm-ingress-1:/data/caddy/pki/authorities/local/root.crt .local/caddy-root.crt
```

`platform-stack.sh` only touches Compose project `${ESM_STACK_PROJECT:-opentrix-esm}`:

| Command | Effect |
| --- | --- |
| `up` | build/start, register manifests from `ESM_MANIFEST_DIR` (default `manifests/`) |
| `migrate` | re-run the controlled migration + manifest registration, then restart the backend |
| `down` | stop containers, **keep volumes** |
| `reset` | delete **only this project's** volumes (explicit and destructive; never run automatically) |

Ports: `127.0.0.1:8443` (Platform HTTPS ingress), `127.0.0.1:8180` (Keycloak). Stop other stacks that use them.
Keycloak runs in `start-dev` with state inside its container: if the container is *recreated*, run
`deploy/provision-keycloak.sh` again (idempotent). PostgreSQL data lives in a named volume and survives.

### Run ESM

```bash
(cd bff && npm ci && npm run build)
(cd web && npm ci && npm run build)
deploy/run-bff-local.sh            # BFF + built SPA on http://localhost:5174
# development: (cd bff && npm run dev) and (cd web && npm run dev)  -> Vite proxies /bff to 127.0.0.1:5174
```

Demo users (passwords are random, in `.local/esm.env`): `esm-requester1`, `esm-requester2`, `esm-agent`, `esm-admin`.

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

The backend caches manifests for its lifetime: `migrate` restarts it. No `DROP`, no migration file is edited; the
Platform's own V1/V2/V3 migrations are unchanged.

## 4. How ESM handles failures

| Situation | Behavior |
| --- | --- |
| 401 / session ended | BFF drops the session; SPA shows a sign-in dialog over the page (no data loss on screen); SSO returns the user |
| 403 | message "no permission"; the UI never relies on this - controls come from `allowedOperations` and `allowedActions` |
| 409 `VERSION_CONFLICT` / `STATE_LOCKED` / `TRANSITION_NOT_ALLOWED` | message + **Reload**; nothing is retried |
| 400 `VALIDATION_FAILED` | errors attached to fields by JSON pointer (`/title`) |
| 503 `COMMIT_OUTCOME_UNKNOWN`, or any lost connection / ingress 502/504 on a write | amber banner; form locked; **Check status** reads the record; only after proof of absence is **Retry with the same request id** offered (create uses a client UUID so the Platform deduplicates) |

The BFF never retries a write. Reads that fail show an error with a Retry button.

## 5. Production notes (not done in this candidate)

* Use HTTPS for `ESM_PUBLIC_ORIGIN` (cookies become `Secure`, HSTS is sent) and a real CA for the Platform ingress.
* The session store is in memory (single BFF instance, sessions lost on restart). Use a shared store to scale out.
* Add rate limiting and monitoring in front of the BFF; rotate `OIDC_CLIENT_SECRET`.
* Replace demo users and the Keycloak dev mode.
