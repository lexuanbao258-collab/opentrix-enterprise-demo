<!--
SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
SPDX-License-Identifier: Apache-2.0
-->

# OpenTrix ESM — IT Helpdesk and HR Leave

OpenTrix ESM is an **independent enterprise service management application**. It is built on the public API of the
[OpenTrix Platform](https://github.com/lexuanbao258-collab/opentrix-v1-candidate) (Enterprise Application Foundation)
and does not modify, import or share a database with it.

This repository delivers **M3: IT Helpdesk** — service categories, support tickets, a role-based ticket workflow,
history and audit — and **M4: HR Leave** — leave requests with a manager approval workflow, history and an auditor-only
audit view — as one React + TypeScript application with its own backend-for-frontend (BFF). Both modules use the same
shell, API client, forms, tables, workflow actions, history/audit components and BFF security; each user sees only the
modules in which the Platform says they hold a role.

> Candidate status: demo quality on a local stack. Not production-ready (see [Known limitations](docs/evidence/M3-evidence.md#known-limitations)).

```
Browser ──HTTPS/HTTP──> ESM BFF (Node) ──Bearer token (server-side)──> Platform ingress (Caddy) ──> Platform API
   SPA (React)           OIDC code+PKCE, CSRF,                          method/path allowlist         (Spring Boot)
   no tokens             route allowlist, sessions                       │
                                                                          └── PostgreSQL (Platform only)
                                   Keycloak (OIDC) <── sign-in redirect ── browser
```

| Part | Directory | What it is |
| --- | --- | --- |
| Application manifests | `manifests/it-helpdesk/app.json`, `manifests/hr-leave/app.json` | `it-helpdesk` **1.1.0**: `category` (unchanged from 1.0.0) + `ticket` entity and workflow. `hr-leave` **1.1.0**: the Platform baseline's manifest, byte-identical |
| BFF | `bff/` | Express 5 + `openid-client`: Authorization Code + PKCE, server-side sessions, CSRF, per-application allowlist proxy |
| Web | `web/` | React 19 + Vite + TypeScript SPA, Vietnamese-first |
| E2E | `e2e/` | Playwright against real PostgreSQL + Keycloak + Platform |
| Deployment helpers | `deploy/` | Platform stack overlay, Keycloak client/user provisioning, upgrade checks |

## Ticket workflow (enforced by the Platform, not by this UI)

```
DRAFT ──submit──> SUBMITTED ──start──> IN_PROGRESS ──resolve──> RESOLVED ──confirm──> CLOSED
  │                  │                     ^                        │
  └──discard──┐      └──cancel──┐          └──────reopen────────────┘
              v                 v
           CANCELLED         CANCELLED
```

| Transition | Who (manifest) |
| --- | --- |
| `submit`, `discard`, `cancel`, `confirm`, `reopen` | requester, only for tickets they created (`own`) |
| `start`, `resolve` | agent or administrator, any ticket, **never the ticket's creator** (`notByCreator`) |
| edit / delete | requester, own ticket, only in `DRAFT` (other states are locked) |
| read | requester: own tickets; agent and administrator: all |
| audit | administrator only; the ticket description is marked `sensitive` and is redacted in audit |

## Leave request workflow (HR Leave; enforced by the Platform)

```
DRAFT ──submit──> PENDING ──approve──> APPROVED
  │                  │   └──reject───> REJECTED
  └──discard──┐      └──withdraw──┐
              v                   v
           CANCELLED          CANCELLED
```

| Transition | Who (manifest) |
| --- | --- |
| `submit`, `discard`, `withdraw` | employee, only for requests they created (`own`) |
| `approve`, `reject` | manager, any request, **never the request's creator** (`notByCreator`) |
| edit / delete | employee, own request, only in `DRAFT` |
| read | employee: own; manager and auditor: all |
| audit | auditor only; the leave reason is `sensitive` and is redacted in audit |

A person holding both `employee` and `manager` can create requests but the Platform refuses (403) their own
approve/reject; another manager must decide. The Platform has no leave balances, calendars or approver routing: ESM does
not pretend otherwise.

The Platform does **not** provide assignee-based authorization, referential integrity between entities, comments
or aggregates. ESM does not pretend otherwise: tickets store a category *code*, there is no assignee, and dashboard
numbers are computed from authorized API pages and labelled when truncated.

## Quick start

Requirements: Node 22+ (tested on 24), Docker with Compose 2.24.4 or newer, bash (Git Bash on Windows), a checkout of the candidate Platform with the M6.1-FIX deployment files. The Platform runtime baseline is
`f401b6e79930a1386e71e92a91ae6a909cfa1e59`. Full instructions are in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```bash
export PLATFORM_DIR=/path/to/hardened-platform-checkout
. deploy/settings.sh
deploy/platform-stack.sh up                 # PostgreSQL, Keycloak, Platform backend, HTTPS ingress (no legacy Portal)
deploy/provision-keycloak.sh                # ESM OIDC client + four demo users (random passwords in .local/esm.env)
docker cp "$ESM_STACK_PROJECT-ingress-1:/data/caddy/pki/authorities/local/root.crt" "$ESM_LOCAL_DIR/caddy-root.crt"
(cd bff && npm ci && npm run build) && (cd web && npm ci && npm run build)
deploy/run-bff-local.sh                     # http://localhost:5174
```

## Tests

```bash
(cd bff && npm test)            # BFF unit/integration tests
(cd web && npm test)            # web unit + component integration tests
(cd e2e && npm ci && npx playwright install chromium && npx playwright test)   # real stack
node scripts/scan-secrets.mjs   # secrets scan of everything publishable
```

## License

Apache-2.0. Codex assisted with the M6.1-FIX deployment, tests and documentation. Original authorship and attributions
are in [NOTICE](NOTICE), next to [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
