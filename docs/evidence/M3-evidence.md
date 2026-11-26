<!--
SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
SPDX-License-Identifier: Apache-2.0
-->

# M3 evidence — OpenTrix ESM: IT Helpdesk

Date: 2026-11-27. Platform baseline: `f401b6e79930a1386e71e92a91ae6a909cfa1e59` (branch `feat/m0-m1-platform-records`).
Application manifest: `it-helpdesk` **1.1.0** (upgrade of 1.0.0). ESM commit: see `git log` of this repository.

## 1. Independence

| Claim | Evidence |
| --- | --- |
| Exact Platform runtime source changes | **None.** `platform-source-diff.txt`: Platform repo `HEAD == f401b6e`, clean tree, `git diff --stat f401b6e -- backend portal-bff frontend apps infra clients docs/api` empty. The checkout used to run the acceptance stack is byte-identical to `git archive f401b6e` (`diff -r` IDENTICAL). |
| ESM has no Java/DB dependency on the Platform | App sources (`bff/src`, `web/src`, `manifests`, `e2e`) contain no `com.tricore`, `jdbc:`, `postgres://`. The only DB-touching file is `deploy/db-snapshot.sh`, an operator evidence script. |
| ESM talks only to published APIs | The BFF proxies only the 8 route shapes of `docs/api/openapi-v1.json`, fixed to app `it-helpdesk` (`bff/src/routes.ts`, tests in `bff/test/app.test.ts`). |
| Platform runs without ESM | The acceptance stack (`opentrix-esm`) runs PostgreSQL, Keycloak, Platform backend and the HTTPS ingress only. ESM is a separate host process; the legacy Portal and Portal BFF were never started (`deploy/compose.esm.yml` removes the ingress dependency on them). |
| ESM builds independently | Own `package.json`/lockfiles, `npm ci && build && test` in `bff/` and `web/`; clean-clone build verified (section 4a). |

Manifest placement: the 1.1.0 manifest lives in **this** repository (`manifests/`) and is deployed through the Platform's
documented controlled step (`platform-migrate` with `PLATFORM_MANIFEST_DIR`). `apps/it-helpdesk/app.json` (1.0.0) in the
Platform repository was not edited.

## 2. Application manifest `it-helpdesk` 1.1.0

* `category` entity, roles `admin/agent/requester`, and all grants of 1.0.0: unchanged (the Platform registrar compares
  them and would refuse any change).
* New `ticket` entity: fields `title`, `description` (sensitive), `categoryCode`, `priority`; search on title,
  description and category code; permissions: read requester `own` / agent `all` / admin `all`; create, update, delete requester `own`;
  audit admin `all`.
* Workflow `DRAFT → SUBMITTED → IN_PROGRESS → RESOLVED → CLOSED` plus `CANCELLED` (`discard`, `cancel`) and `reopen`
  (requester rejects a resolution). Only `DRAFT` is editable. `start` and `resolve` carry `notByCreator`.

Not claimed (not enforced by the Platform): per-assignee authorization, referential integrity between `ticket.categoryCode`
and `category`, comments/resolution notes, SLA or advanced workflow rules.

### Upgrade and compatibility evidence

| Check | Result | File |
| --- | --- | --- |
| Upgrade 1.0.0 → 1.1.0 with data | accepted; `applications` = 1.1.0, `application_versions` = {1.0.0, 1.1.0}; schema history V1–V3 `success`; **category rows (4, version/data fingerprint `3250486f…`) byte-identical** before and after | `db-snapshot-1.0.0-before-upgrade.txt`, `db-snapshot-1.1.0-after-upgrade.txt`; E2E `upgrade.spec.ts` compares the original ids/versions through the API |
| Fresh installation of 1.1.0 | accepted on a brand-new project (`opentrix-esm-fresh`, new volumes); full E2E 57 pass / 0 fail / 2 skipped | `db-snapshot-fresh-install.txt`, `e2e-results-fresh-install.json` |
| Unsafe 1.2.0 variants | 9/9 refused, active version stays 1.1.0 (broadened grants, changed field, new required field, removed transition, dropped `notByCreator`, removed role/entity) | `incompatible-upgrades.txt`. Note: `role-removed` is refused by manifest validation (a transition references an undeclared role), not by the registrar compatibility check. |
| Restart preserves data | stack stopped and started (volumes kept): snapshot identical (`ticket` 248 rows, `category` 4) | `db-snapshot-before-restart.txt`, `db-snapshot-after-restart.txt` |
| No destructive operation | no `DROP`, no `down -v` on the acceptance project, no change to V1/V2/V3; the only volume deletion avoided entirely | — |

Observation (Platform demo, not ESM): the Keycloak container runs `start-dev` with state inside the container. When the
container is **recreated** (it was, once, by `compose up` after `down`), ESM's client and users disappear; PostgreSQL
data does not. `deploy/provision-keycloak.sh` is idempotent and restores them.

## 3. API integration

All calls go browser → BFF → ingress → Platform with the user's own access token (never a shared machine credential).

| Capability | Where |
| --- | --- |
| Discovery (`GET app`, `GET entity`) and capabilities (`allowedOperations`, workflow summary) | `web/src/auth/AuthContext.tsx`, `api/client.ts` |
| List/read, search `q`, pagination `limit/offset` | `pages/TicketList.tsx`, `Categories.tsx`, `Audit.tsx` |
| Create with client-generated UUID (idempotent) | `pages/TicketForm.tsx` (`useRef(crypto.randomUUID())`), `Categories.tsx` |
| Update / delete with `expectedVersion` | `TicketForm.tsx`, `TicketDetail.tsx`, `Categories.tsx` |
| Workflow state, `allowedActions`, transition, history | `TicketDetail.tsx` — buttons are rendered from `allowedActions`, not from the manifest |
| Audit read (admin grant only) | `pages/Audit.tsx`; route and navigation exist only when `allowedOperations.audit` is present |
| Error handling | 400 field errors; 401 session dialog; 403/404/409 messages; 503/connection loss → `COMMIT_OUTCOME_UNKNOWN` banner, check-by-reading, same-id retry; no automatic write retry anywhere |
| Dashboard aggregation | computed from authorized pages (≤500 records); text states "toàn bộ N phiếu" or "N phiếu mới nhất trong tổng M … có thể thấp hơn thực tế" |

Security of the access path: `esm-bff` is a confidential client, Authorization Code + PKCE (S256) + state + nonce; tokens
stay server-side; opaque `HttpOnly; SameSite=Lax` session cookie; CSRF token + `Origin` check on every write; explicit
route/method/query allowlist; 64 KiB body limit; CSP `default-src 'self'` without inline scripts/styles; session idle
30 min / absolute 8 h; refresh-token rotation handled once per session (single flight).

## 4. Test evidence (real counts, nothing mocked in acceptance)

| Suite | Result | Command |
| --- | --- | --- |
| BFF unit/integration (fake OIDC + fake upstream) | **21 passed, 0 failed, 0 skipped** | `cd bff && npm test` |
| Web unit + component integration | **30 passed, 0 failed, 0 skipped** (mutation-checked: removing CSRF header or per-attempt id generation makes tests fail) | `cd web && npm test` |
| TypeScript | `tsc --noEmit` clean for `bff`, `web`, `e2e` | `npm run typecheck` |
| Build | `vite build`, `tsc` build succeed | `npm run build` |
| Playwright E2E, upgraded stack (1.0.0 data → 1.1.0, after restart) | **58 passed, 0 failed, 1 skipped** (mobile-menu test is skipped on the desktop project by design) | `ESM_E2E_UPGRADE=1 ESM_E2E_OUTAGE=1 npx playwright test` → `e2e-results-upgraded-stack.json` |
| Playwright E2E, fresh installation | **57 passed, 0 failed, 2 skipped** (upgrade-data check not applicable; same mobile-menu skip) | `e2e-results-fresh-install.json` |
| `npm audit --omit=dev` | 0 vulnerabilities (bff, web) | — |
| Secret scan (16 real secret values from `.local/*.env` + 4 patterns, over tracked files, build output, evidence) | `SECRET_SCAN_PASS` | `node scripts/scan-secrets.mjs` |

E2E projects: `setup` (real Keycloak sign-in for 4 roles), `desktop` (1280×800), `layout-desktop`, `layout-mobile`
(Pixel 7 emulation, Chromium). Scenarios: full request → handle → confirm → audit flow; draft edit/delete; category CRUD;
45-ticket pagination/search/state-filter/dashboard-equals-API; session expiry and logout (incl. no silent SSO after logout);
unauthenticated/forged-token rejection at BFF and ingress; CSRF; allowlist; cross-requester isolation (read, list, search,
workflow, history, transition, update, delete); role grants (requester vs agent vs admin); locked states; invalid transition;
stale version; state forgery via generic writes; audit authorization and redaction; idempotent create; concurrent transition
(exactly one winner); validation keyed by field; **backend outage** (container stopped mid-request: UI shows unknown outcome,
read proves absence, same-id retry creates exactly one ticket; API write returns `503 COMMIT_OUTCOME_UNKNOWN`);
axe-core WCAG 2 A/AA (serious/critical = 0) and no horizontal overflow on 9 pages × desktop and mobile.

Defects found by this testing and fixed before the final runs: (1) the page unmounted (blank screen) when the session
expired because the layout required a signed-in state — now the page stays mounted under the sign-in dialog (regression
test added); (2) sidebar/menu buttons visible on desktop and an invisible logout button (CSS specificity); (3) the state
filter control had a polluted accessible name; (4) scrollable table regions were not keyboard-focusable; (5) the ingress
answering 502/504 to a write was passed through as a plain error — it is now `COMMIT_OUTCOME_UNKNOWN`. Two flaky test
assertions (random CSRF token containing `eyJ`; debounce race in the pagination spec) were corrected, not ignored.

Skipped: exactly the three listed above; nothing else is skipped or retried (`retries: 0`, `flaky: 0`).

### 4a. Clean clone

`git clone` of the local ESM repository into a temp directory (no `.local`, no `node_modules`): `npm ci --ignore-scripts`,
`typecheck`, `test` (BFF 21/21, web 30/30) and `build` succeed in `bff/` and `web/`; the secret scan passes on the clone.
Manifest bytes survive the commit (`sha256` `fc97b12b…` for 1.1.0 and `2c577314…` for the 1.0.0 fixture, equal to the registered hashes);
`.gitattributes` forces LF so the hashes do not depend on the checkout platform.

## 5. Screenshots (`screenshots/`, taken during the real runs, no credentials on screen)

`01`–`07` main business flow (create form, submitted, my requests, agent queue, resolved, closed with history, admin audit);
`08` categories; `09` session expired dialog; `10` pagination; `11` requester dashboard; `12` unknown outcome during backend outage;
`layout-desktop-*` and `layout-mobile-*` for nine pages.

## 6. License and attribution

Apache-2.0 (`LICENSE`). Reused with attribution (`NOTICE`): the Platform's `it-helpdesk` 1.0.0 manifest (category entity),
Platform BFF *patterns* (no code copied), the Be Vietnam Pro font (OFL-1.1) as in the Platform Portal.
`THIRD-PARTY-NOTICES.md` lists 211 npm packages (MIT 183, Apache-2.0 9, ISC 8, MPL-2.0 4 [dev tooling], BSD-3 3, BSD-2 2, OFL-1.1 1, BlueOak-1.0.0 1).
Hallmark/Impeccable design skills were **not installed**; UI design was done directly and reviewed with axe-core and screenshots.

## 7. Known limitations

* In-memory BFF sessions (single instance; lost on restart). No rate limiting. Demo-grade Keycloak (dev mode) and local CA. Not production-ready.
* No assignee, comments or resolution notes: the Platform has no per-assignee authorization and generic edits are locked after submit.
  Who handled a ticket is visible only as an opaque actor suffix in history (no directory lookup in the Platform API).
* `ticket.categoryCode` is not a referential integrity constraint; deleting a category leaves tickets with its code (the UI shows the code).
* The API has no state filter or aggregate endpoint: state filter and dashboard scan at most 500 authorized records and say so when truncated.
* Audit view shows redacted JSON as returned; no field-level diff rendering.
* E2E data is not cleaned up (only drafts can be deleted); tests use unique run ids. Browsers: Chromium only (mobile is emulation).
* Frontend coverage percentage was not measured. Visual review of mobile layouts was by screenshots/automated checks, not on physical devices.
* Platform observations (not blockers, no Platform change made): no server-side state filter/aggregates; no actor display names; `PlatformRuntimeGuard` is startup-only (Platform ADR).
