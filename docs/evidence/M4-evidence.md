<!--
SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
SPDX-License-Identifier: Apache-2.0
-->

# M4 evidence — OpenTrix ESM: HR Leave as the second module

Date: 2026-11-27. Platform baseline: `f401b6e79930a1386e71e92a91ae6a909cfa1e59`. M3 checkpoint: `d13d999`.
ESM implementation commit: `47085c4` (this file is committed right after it).

## 1. Result

HR Leave runs as a second module of the same ESM application on the same Platform stack, with the same shell, API
client, BFF, session/CSRF handling, forms, tables, workflow actions and history/audit components. Platform source,
migrations and API are untouched. `hr-leave` **1.1.0** is the baseline manifest, byte-identical (sha256 `0f717f2b…`).

## 2. Test results (real stack: PostgreSQL + Keycloak + Platform + ESM BFF; nothing mocked in E2E)

| Suite | PASS | FAIL | SKIP | Notes |
| --- | --- | --- | --- | --- |
| BFF unit/integration | 23 | 0 | 0 | +2 vs M3 (HR allowlist, cross-app 404s, actor id) |
| Web unit + component | 60 | 0 | 0 | +30 vs M3 (HR pages, routing, navigation, validation) |
| TypeScript (`bff`, `web`, `e2e`) | clean | — | — | `tsc --noEmit` |
| Build (`bff` tsc, `web` vite) | OK | — | — | |
| Playwright full run (`ESM_E2E_UPGRADE=1 ESM_E2E_OUTAGE=1`) | **113** | **0** | **3** | `e2e-results-m4-full.json`. Skips: restart spec (needs a restart), 2 mobile-only tests on the desktop layout project (by design) |
| Playwright after stack restart (`ESM_E2E_RESTART=1`) | 12 | 0 | 0 | `e2e-results-m4-restart.json` |
| `npm audit` (bff, web, e2e; all and `--omit=dev`) | 0 vulnerabilities | — | — | |
| Licenses | no new dependency; summary unchanged (`THIRD-PARTY-NOTICES.md`) | | | |
| Secret scan | PASS | | | 113 files, 21 real secret values, 4 patterns |
| Clean-clone verification (commit `47085c4`) | OK | — | — | section 9 |

One earlier full run had 2 failures in my new keyboard-order test (it assumed a native date input is one tab stop);
the test was fixed (it now walks the tab stops) and the full run above is the re-run. No product code changed for that.

M3 regression: all M3 specs (ticket flow, categories, search/pagination, outage, session, security, upgrade, layout) pass
unchanged **except one assertion that I changed deliberately**: `security.spec.ts` "the BFF forwards only the it-helpdesk
allowlist" asserted that `/bff/api/v1/apps` and `hr-leave` paths return 404. M4 legitimately allows discovery and
`hr-leave`, so it now asserts that unknown apps, cross-module entity names and non-listed methods are still 404.

## 3. Required scenario (E2E `hr-flow.spec.ts`, 19 passing steps incl. sign-ins)

| # | Step | Evidence |
| --- | --- | --- |
| 1 | `esm-employee1` signs in (PKCE), lands on HR Leave (no IT navigation), client validation blocks bad input, creates a draft, edits it (version check), | `hr-01`, test "employee signs in, creates…" |
| 2 | submits → `PENDING`; edit/delete gone, only "Rút đơn" offered | `hr-02` |
| 3 | `esm-dual` (employee **and** manager) creates + submits; no approve/reject button, explanatory note; queue shows the request flagged "Đơn của bạn"; direct API approve/reject → **403 FORBIDDEN**, record unchanged (`PENDING`, same version) | `hr-03`; also `hr-security` "employee-and-manager…" |
| 4 | `esm-manager` (another manager) finds it in the queue (server search on `reason`), approves → `APPROVED`; `esm-dual` also rejects another employee's request; `esm-manager` rejects after a confirmation dialog | `hr-04`, `hr-05`, `hr-06` |
| 5 | employee sees the actual `APPROVED` / `REJECTED` status in list, detail, workflow history (3 events: create, submit, approve) and dashboard | `hr-07`, `hr-08` |
| 6 | `esm-auditor` sees 4 audit events (create, update, submit, approve); `reason` is `[REDACTED]` in UI and API | `hr-09` |
| 7 | unauthorized: see section 4 | `hr-11` |
| 8 | IT Helpdesk regression: full M3 suite PASS | section 2 |
| 9 | restart: stack `down` (volumes kept) + `up`; DB snapshot **identical** (`leaveRequest` 70 rows md5 `69e19f30…`, `ticket` 432, `category` 4); records written by the flow still exist with the same states | `m4-db-snapshot-before/after-restart.txt`, `e2e-results-m4-restart.json` |
| 10 | build + clean clone | section 9 |

## 4. Security negative tests (`hr-security.spec.ts`, 19 passing; all direct API calls through the BFF, not hidden UI)

* **Discovery**: `GET /apps` returns exactly `[it-helpdesk]` for IT roles, `[hr-leave]` for HR roles, both for `esm-dual`.
* **IT roles alone → no HR**: requester/agent/admin get 404 on the HR app, entity, list, read, create, approve, audit.
* **HR roles alone → no IT**: employee/manager/auditor get 404 on the IT app, tickets, categories, audit.
* **BFF allowlist**: unknown app, `ticket` under `hr-leave`, `leaveRequest` under `it-helpdesk`, IT transitions on HR and vice versa,
  malformed ids, `..%2F` transition, PATCH, DELETE on the collection, POST on discovery → 404 (nothing forwarded).
* **Session/CSRF**: unauthenticated 401; missing/forged CSRF token, foreign Origin, and another user's CSRF token → 403, nothing written.
* **Isolation**: employee2 cannot read/list/edit/delete/withdraw/approve employee1's request (404) nor audit (403); search does not reveal it.
* **Grants**: employee cannot decide; manager cannot create/edit/delete/withdraw/audit; auditor is read + audit only.
* **notByCreator**: creator-manager approve/reject → 403; another manager approves; decisions are final (`TRANSITION_NOT_ALLOWED`); a manager-employee can still reject someone else's request.
* **Stale/locked**: stale `expectedVersion` → 409 `VERSION_CONFLICT`; approving after withdraw → 409; edit/delete in `PENDING`/`APPROVED` → 409 `STATE_LOCKED`; invalid transitions → 409; two managers racing → exactly one 200; state cannot be forged through generic writes (400).
* **Schema**: days 0/31/1.5, bad kind/date/reason, missing or extra fields → 400 with JSON-pointer errors.
* **Sensitive data**: audit events redacted (`[REDACTED]`, other fields kept), audit only for the auditor; error bodies (400/403/404/409/413) never echo the reason; the reason does not appear in the BFF log nor in the backend, ingress and postgres container logs; session JSON carries no token or HR data.

## 5. Screenshots (`docs/evidence/screenshots/`)

`hr-01…hr-11` (flow), `layout-{desktop,mobile}-hr-*` and `layout-*-dual-both-apps` (every HR page on both viewports, each with
axe WCAG 2 A/AA/2.1 AA serious/critical = 0 and zero horizontal overflow), `layout-mobile-dual-menu`.
Keyboard: form fields reachable in order with accessible labels (E2E); mobile menu switches between modules.
Expired-session dialog is the shared M3 component (`09-session-expired.png`, session spec passes).

## 6. Platform source diff (`m4-platform-source-diff.txt`)

Platform repo `HEAD == f401b6e`, clean tree, `git diff --stat f401b6e` (whole repo, committed and working tree) **empty**;
the checkout used to run the stack is byte-identical to `git archive f401b6e` (`diff -r` IDENTICAL).
**Changed Platform runtime-source files: 0; lines: 0** (supported by that Git evidence).

## 7. Reusability measurements (ESM vs `d13d999`; `git diff --numstat`, screenshots/evidence excluded)

| Category | Files | Lines |
| --- | --- | --- |
| **Platform** runtime source changed | 0 | 0 |
| HR-specific application source (new): `pages/Leave{Dashboard,List,Detail,Form,Audit}.tsx`, `domain/leave.ts` | 6 | 656 |
| HR-specific UI strings (`i18n/vi.ts`, added) | 1 (shared file) | +92 |
| HR-specific tests: `leave.test.tsx` 293, `hr-flow` 292, `hr-security` 327, `hr-restart` 34 | 4 | 946 |
| Manifest `hr-leave` (copied unmodified, not authored) | 1 | 54 |
| Generalization of shared code so that one app became many (new `components/History.tsx` 42; `api/client.ts` +39/−26; `AuthContext` +53/−11; `Layout` +54/−14; `App` +42/−3; `Audit` +40/−13; `TicketDetail` +6/−19; `bff/routes.ts` +31/−18; `bff/oidc.ts` +12/−1; `bff/app.ts` +4/−4; `config.ts` −2; small edits in `types`, `format`, `tickets`, `ui`, `styles`) | 16 | ≈ +340 / −115 |
| Shared test infrastructure (fixtures, BFF tests, e2e support/layout/security/setup) | 6 | ≈ +190 / −26 |
| Deployment/config: `provision-esm.sh` +25/−15 (HR roles in client scope, 5 HR users), `provision-keycloak.sh` +6, `NOTICE`, docs | 5 | ≈ +90 |
| Compose overlay, `platform-stack.sh`, ingress, Platform migrations | 0 changed | 0 |

**Reused without modification**: `bff/sessions.ts`, `bff/main.ts`, the login/callback/session/logout, CSRF, body-limit, upstream-timeout and
unknown-outcome logic of `bff/app.ts`; `Button`, `Spinner`, `Alert`, `EmptyState`, `PageHeader`, `StatusBadge`, `TableWrap`, `Pagination`,
`Field`, `ConfirmDialog`; `useLoad`/`useDebounced`; `domain/errors.ts`; `formatDateTime`; `collect`; the API transport; `AuthProvider`; the shell.

**Manifest/deployment changes required for HR**: add `manifests/hr-leave/app.json` (documented `platform-migrate` registration, no
compose change); add the three HR role names to the `esm-bff` client scope; create users; one `ALLOWED_APPS` entry in the BFF.

Interpretation: the first additional module cost ≈ 340 lines of one-time generalization of M3's single-app coupling (app id,
discovery, nav, audit/history). The module itself is ≈ 650 source lines plus a manifest. This is a measurement of this
repository's change, **not** a quantified development-time saving: there is no baseline of building HR from scratch, so no
time-saving figure is claimed.

## 8. Design notes and findings

* **Discovery-driven visibility**: `GET /bff/api/v1/apps` (Platform "applications in which the caller holds a role") decides which module
  appears; per-entity `allowedOperations` and per-record `allowedActions` decide controls. Route guards use the same data; the Platform still authorizes every call.
* **Finding — `createdBy` is not the OIDC `sub`**. The Platform stores `oidc:base64url(iss).base64url(sub)` (documented in its `docs/API.md`).
  The first draft compared `sub` and would have mis-identified own records; the BFF now returns the documented actor id
  (`/bff/session` → `user.id`), unit-tested against a live value. ESM relies on that documented format.
* **No owner/state filter in API v1**: "my requests" for a user who may read all (employee + manager), and the approval queue, scan up to 500 authorized
  records and filter client-side, with an explicit warning when truncated. Employee-only callers are paged on the server.
  Dashboard numbers state "toàn bộ N đơn" only when everything was loaded.
* The manifest declares no transition names; Vietnamese labels (Gửi duyệt, Phê duyệt, Từ chối, Rút đơn, Hủy bản nháp) live in the UI. Reject/withdraw/discard ask for confirmation.
* The IT module still lives at `/`; HR lives under `/hr/*`. HR-only users are redirected from `/` to `/hr`.

## 9. Clean clone

Fresh `git clone` of commit `47085c4` into a temp directory: `npm ci --ignore-scripts`, `typecheck`, `test`, `build` for `bff` (23 passed) and `web` (60 passed) all OK; `e2e` `npm ci` + `tsc --noEmit` OK; secret scan PASS; `manifests/hr-leave/app.json` sha256 `0f717f2b…` identical to the Platform baseline. (Playwright was run in the working checkout against the live stack, section 2.)

## 10. Known limitations

* Demo quality, local stack; same production gaps as M3 (in-memory sessions, Keycloak dev mode, no rate limiting).
* The Platform has no leave balances, calendars, delegation or approver routing; ESM implements none. A rejection carries no comment (the transition API accepts only `expectedVersion`).
* Managers (and auditors) read every employee's `reason` — that is the manifest's `read: all`; only the **audit trail** redacts it.
* The approval queue lists the caller's own pending requests (flagged) because the API cannot exclude them; the Platform refuses the decision.
* Owner/state views scan at most 500 records (labelled); a very large tenant needs a server-side filter in the Platform.
* People are shown as "Bạn" or the last 6 characters of the actor id: the Platform has no user directory.
* Layout/accessibility checks use Chromium (desktop 1280×800, Pixel 7); automated axe checks do not replace a manual screen-reader review.
* Notably unverified: behavior under a Keycloak realm that issues HR roles through another client mapping; only the demo realm was exercised.
