<!--
SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
SPDX-License-Identifier: Apache-2.0
-->

# OpenTrix ESM — IT Helpdesk

OpenTrix ESM is an **independent enterprise service management application**. It is built on the public API of the
[OpenTrix Platform](https://github.com/lexuanbao258-collab/opentrix-v1-candidate) (Enterprise Application Foundation)
and does not modify, import or share a database with it.

This repository delivers **M3: IT Helpdesk** — service categories, support tickets, a role-based ticket workflow,
history and audit — as a React + TypeScript application with its own backend-for-frontend (BFF).

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
| Application manifest | `manifests/it-helpdesk/app.json` | `it-helpdesk` **1.1.0**: `category` (unchanged from 1.0.0) + new `ticket` entity and workflow |
| BFF | `bff/` | Express 5 + `openid-client`: Authorization Code + PKCE, server-side sessions, CSRF, allowlist proxy |
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

The Platform does **not** provide assignee-based authorization, referential integrity between entities, comments
or aggregates. ESM does not pretend otherwise: tickets store a category *code*, there is no assignee, and dashboard
numbers are computed from authorized API pages and labelled when truncated.

## Quick start

Requirements: Node 22+ (tested on 24), Docker with Compose 2.24+, bash (Git Bash on Windows), a checkout of the
Platform at the frozen baseline `f401b6e79930a1386e71e92a91ae6a909cfa1e59`. Full instructions:
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```bash
export PLATFORM_DIR=/path/to/platform-checkout-at-f401b6e
deploy/platform-stack.sh up                 # PostgreSQL, Keycloak, Platform backend, HTTPS ingress (no legacy Portal)
deploy/provision-keycloak.sh                # ESM OIDC client + four demo users (random passwords in .local/esm.env)
docker cp opentrix-esm-ingress-1:/data/caddy/pki/authorities/local/root.crt .local/caddy-root.crt
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

Apache-2.0, see [LICENSE](LICENSE), [NOTICE](NOTICE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
