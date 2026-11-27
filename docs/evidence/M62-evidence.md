<!--
SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
SPDX-License-Identifier: Apache-2.0
-->

# M6.2 - UI/UX final polish: evidence

Base: `fix/m6.1-release-hardening` @ `8705d53`. Branch: `feat/m6.2-ui-polish`. Platform runtime baseline `f401b6e` (deployment `179d61d`) was not touched.
No backend, BFF, Platform, manifest or API-contract change. No dependency added.

Screenshots: `docs/evidence/m62/before/` (baseline build) and `docs/evidence/m62/after/` (this branch), desktop 1280x800 and Pixel 7,
both captured on the same curated demo dataset (separate disposable stack `opentrix-esm-m62-demo`, created for this milestone).

## 1. Visual audit of the baseline (recorded before changes)

| # | Finding | Where |
| --- | --- | --- |
| A1 | Brand mark was a letter "O" in a square; no favicon. | shell, sign-in |
| A2 | Dashboard: four equal tiles + the 5 latest records in whatever state. Nothing said what needs the user now; tiles were not links. | both dashboards |
| A3 | Detail pages: state was one small badge in a property grid; version number shown to everyone; "Edit" and "Delete" sat together in the header; the first workflow action was always "primary" even if it cancelled or rejected; cancel/discard of an IT ticket ran without confirmation (HR already confirmed). | ticket/leave detail |
| A4 | History and lists showed raw actor-id tails ("Người thực hiện …M4ZWNi"): meaningless to people. | history, HR list/detail |
| A5 | An agent saw "Phiếu đã gửi nên không thể chỉnh sửa hoặc xóa" although agents can never edit or delete. | ticket detail |
| A6 | Tables: a leading UUID-prefix column ahead of the title; dates wrapped over two lines; UPPERCASE headers (hurts Vietnamese diacritics); heavy underlined links. | lists |
| A7 | Date/time rendered as `16:41 27/11/26` (time first, 2-digit year). **Defect:** the `formatDate` regex had lost its backslashes (`d{4}`), so HR dates always showed raw ISO `2026-12-22`. | all |
| A8 | Header repeated the user's name (already in the sidebar); a user with both modules had no explicit module switch, only two stacked sidebar groups. | shell |
| A9 | Mobile drawer: no Escape, focus not moved in/returned, page behind scrolled; single-column property grid, and actions came after the description. | shell, detail |
| A10 | Forms: one flat list of fields; no grouping, no character counter, no focus on the first invalid field. | forms |
| A11 | Purple "resolved" and amber "in progress"/"submitted" mixed meanings; shadows on every card and table. | design system |

Kept as they were (working, no justification to redesign): sidebar information architecture, route structure, breadcrumb, the table-to-card
responsive pattern, `Be Vietnam Pro` (full Vietnamese glyph support), the focus ring, the sign-in and session-expired flow.

## 2. Design decisions

* **One neutral navy shell, one blue accent.** Tokens refined in `styles.css`; shadows removed (borders only); radii 8/6; no gradients or decorative motion.
* **Semantic status colors (single table, `ui.tsx` `STATE_TONE`):** amber = waiting for someone, blue = being worked on, teal = awaiting confirmation,
  green = completed/approved, red = refused/urgent, grey = draft/cancelled. Every badge has a leading dot and a text label (never color alone).
* **Logo:** `components/Logo.tsx` (ring + core) in the sidebar, sign-in and error screens; `public/favicon.svg` matches. Inline SVG, CSP-safe (the BFF CSP forbids inline styles; none are used).
* **Shell:** module switcher (segmented links, `aria-current`) in the header for users holding both applications, the module name for single-module users.
  The sidebar keeps both groups (headings with icons, current module emphasised) so role-based visibility is unchanged. Name, roles and logout live only in the sidebar foot.
  Mobile drawer: Escape, focus in/out, scroll lock, closes on resize to desktop.
* **Dashboards:** an "attention" list first (IT staff: waiting + in progress, urgent first; requester: resolved-to-confirm + drafts; HR manager: pending;
  employee: drafts + pending; auditor: pending, read-only), then state tiles that link into the pre-filtered list (`?state=`), then recent activity (excluding what is already shown above).
  All numbers come from the same authorized `collect()` call as before; the 500-record disclosure (`scope-note`) is unchanged. No new metrics, charts or SLAs.
* **Lists:** title first with the short record id as a muted second line (still reachable, no longer a column); readable dates; no uppercase headers; "Trang x/y" in the pager.
  Other people's creator ids are no longer printed (the tail stays in a tooltip; the full id and version are in a folded "Thông tin kỹ thuật" block on the detail page).
* **Detail pages:** status banner (large badge + one plain sentence about what happens next); on mobile the actions come first, then the data, then the history (CSS grid areas).
  Forward actions are primary/secondary. **Ending actions (cancel, discard, reject, withdraw) and delete form a separate "Hủy hoặc từ chối" group, red outline, never primary, always confirmed** (IT now confirms like HR).
  Buttons are only rendered from `workflow.allowedActions` / `allowedOperations`. `expectedVersion`, stable create UUIDs, CSRF and unknown-outcome reconciliation code paths are untouched.
* **Forms:** grouped sections, category + priority (IT) and date + days (HR) side by side, live character counter, focus on the first invalid field. Fields and validation rules are unchanged.
* **Vietnamese terminology:** same vocabulary; the creator column's "Đơn của bạn" became "Bạn"; "Nhân viên khác" replaces opaque ids.

## 3. Changed files

`web/src/styles.css` (rewritten tokens/components); modified `components/{Layout,ui,History}.tsx`, `pages/{Dashboard,LeaveDashboard,TicketList,LeaveList,TicketDetail,LeaveDetail,TicketForm,LeaveForm}.tsx`,
`App.tsx`, `domain/{format,tickets}.ts`, `i18n/vi.ts`, `web/index.html`; new `components/{Logo,Detail,RecordList}.tsx`, `web/public/favicon.svg`.
Tests: `domain/domain.test.ts`, `pages/leave.test.tsx`, new `components/Detail.test.tsx`, new `e2e/tests/ui-polish.spec.ts`, one assertion in `e2e/tests/hr-flow.spec.ts`
("Đơn của bạn" -> "Bạn", an intentional label change). Tooling: `e2e/scripts/seed-demo.ts`, `e2e/scripts/shots-m62.ts`; docs: `docs/DEVELOPMENT.md` section 6.

## 4. Results

| Check | Result |
| --- | --- |
| TypeScript (web, bff, e2e) | PASS |
| BFF unit tests | 25 / 25 PASS |
| Web unit tests | 68 / 68 PASS (61 before; +7: date formatting, urgency order, ActionPanel/StatusBanner) |
| Production build (web, bff) | PASS |
| Full Playwright regression on the regression stack (IT + HR flows, security, session, categories, search/pagination, outage, layout desktop + mobile, new UI specs) | **119 PASS, 0 FAIL, 4 SKIP** |
| Layout re-run after the last CSS tweak (axe wcag2a/2aa/21aa serious+critical, no horizontal overflow; 18 pages x desktop + mobile) | 50 PASS, 2 SKIP |
| Secret scan (`scripts/scan-secrets.mjs`) | PASS |
| Disk (C:) | 23 GB free throughout (limit 10 GB) |

Skipped, with reasons: `hr-restart` (needs a stack restart between two runs), `upgrade` (needs a stack seeded under manifest 1.0.0 and then upgraded), and the two "mobile only" layout tests when they run in the desktop layout project (they execute in the mobile project).
The outage scenario (unknown outcome, reconcile by reading, retry once with the same id) was run with `ESM_E2E_OUTAGE=1` and passed. Session expiry, error handling, workflow restrictions and authorization are covered by `session`, `outage`, `ticket-flow`, `hr-flow`, `security`, `hr-security` specs, all green.

Defects found while testing my own change: (1) the drawer's close button could not take focus on the first frame (the drawer is `visibility:hidden` until its transition starts); fixed with a 50 ms deferred focus, covered by `ui-polish.spec.ts`. (2) the pre-existing date regex defect (A7); fixed, covered by a unit test.

Accessibility / keyboard evidence: axe scan of 18 representative pages in both viewports (above); existing keyboard specs (forms, skip link, dialogs) pass; new specs cover switcher semantics, Escape/focus return/scroll lock on mobile, confirmation dialogs and focus on the first invalid field.

## 5. Demo data

`seed-demo.ts` created through the public API only: 5 categories, 16 tickets (draft 1, submitted 3, in progress 5 incl. one reopened, resolved 2, closed 3, cancelled 2) and 10 leave requests
(draft 1, pending 3 incl. one created by the dual-role user who therefore cannot approve it, approved 3, rejected 1, cancelled 2 = one withdrawn and one discarded)
on the separate project `opentrix-esm-m62-demo` (ports 18844/18880/18874). Nothing was inserted into a database and nothing was deleted anywhere. The regression stack's SEC/pagination fixtures were not used for any screenshot.
The API does not allow back-dating, so every demo record carries the same timestamp.

## 6. Remaining limitations

* All demo records share one timestamp (above); a real tenant would show a spread.
* The requester dashboard tile "Đã gửi" (submitted + in progress) is not a link, since API v1 has no multi-state filter.
* The state filter and dashboards still scan at most 500 authorized records client-side (disclosed in the UI); API v1 has no server-side state filter.
* The Platform API exposes no display names for other users, so lists say "Nhân viên khác" instead of a name.
* Mobile table-to-card rows are tall; acceptable, not further compacted.
* The logo is an original placeholder mark for the demo, not a finalized brand asset.
* The regression stack is shared with earlier milestones (432+ IT tickets, ~70+ HR requests of fixtures); it was only added to by the regression suite, never cleaned.
