// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { Link } from "react-router-dom";
import { collect } from "../api/client";
import type { Ticket } from "../api/types";
import { useReady } from "../auth/AuthContext";
import { RecordList } from "../components/RecordList";
import { Alert, Button, EmptyState, PageHeader, PriorityBadge, Spinner, StatusBadge, Tile, stateTone } from "../components/ui";
import { messageFor } from "../domain/errors";
import { formatDateTime } from "../domain/format";
import { byRecent, byUrgency, categoryName, countByState, stateLabel } from "../domain/tickets";
import { useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

const CAP = 500;
const SHOWN = 5;

export function Dashboard() {
  const { caps, categories } = useReady();
  const staff = caps.ticket.allowedOperations.read === "all";
  const data = useLoad(() => collect<Ticket>("ticket", { cap: CAP }), []);

  if (data.loading && !data.data) return <Spinner />;
  if (data.error) {
    return <Alert tone="error" title={vi.errors.generic} actions={<Button onClick={data.reload}>{vi.common.retry}</Button>}>{messageFor(data.error)}</Alert>;
  }
  const { items, total, truncated } = data.data!;
  const counts = countByState(items).byState;
  const n = (state: string) => counts[state] ?? 0;
  const listPath = staff ? "/tickets" : "/my-requests";
  const tiles = staff
    ? [
        { key: "SUBMITTED", label: vi.dashboard.waiting, value: n("SUBMITTED"), to: `${listPath}?state=SUBMITTED` },
        { key: "IN_PROGRESS", label: vi.dashboard.working, value: n("IN_PROGRESS"), to: `${listPath}?state=IN_PROGRESS` },
        { key: "RESOLVED", label: vi.dashboard.awaitingConfirm, value: n("RESOLVED"), to: `${listPath}?state=RESOLVED` },
        { key: "CLOSED", label: vi.dashboard.closed, value: n("CLOSED"), to: `${listPath}?state=CLOSED` },
      ]
    : [
        { key: "DRAFT", label: vi.dashboard.drafts, value: n("DRAFT"), to: `${listPath}?state=DRAFT` },
        { key: "SUBMITTED", label: vi.dashboard.submitted, value: n("SUBMITTED") + n("IN_PROGRESS"), to: undefined },
        { key: "RESOLVED", label: vi.dashboard.resolved, value: n("RESOLVED"), to: `${listPath}?state=RESOLVED` },
        { key: "CLOSED", label: vi.dashboard.closed, value: n("CLOSED"), to: `${listPath}?state=CLOSED` },
      ];

  // What needs the caller now: staff take over waiting tickets and finish those in progress (urgent first);
  // a requester confirms resolved tickets or sends drafts. Counts come from the loaded authorized records only.
  const attentionStates = staff ? ["SUBMITTED", "IN_PROGRESS"] : ["RESOLVED", "DRAFT"];
  const attentionAll = items.filter((item) => attentionStates.includes(item.state ?? ""));
  const attention = (staff ? [...attentionAll].sort(byUrgency) : [...attentionAll].sort(byRecent)).slice(0, SHOWN);
  const shown = new Set(attention.map((item) => item.id));
  const recent = items.filter((item) => !shown.has(item.id)).sort(byRecent).slice(0, SHOWN);
  const row = (record: (typeof items)[number]) => ({
    id: record.id, to: `/tickets/${record.id}`, title: record.data.title,
    meta: `${categoryName(categories, record.data.categoryCode) ?? record.data.categoryCode} · ${formatDateTime(record.updatedAt)}`,
    badges: (
      <>
        <PriorityBadge priority={record.data.priority} label={vi.priority[record.data.priority] ?? record.data.priority} />
        <StatusBadge state={record.state} label={stateLabel(caps, record.state)} />
      </>
    ),
  });

  return (
    <>
      <PageHeader
        title={vi.dashboard.title}
        subtitle={staff ? vi.dashboard.subtitleStaff : vi.dashboard.subtitleRequester}
        actions={caps.ticket.allowedOperations.create ? <Link className="btn btn-primary" to="/tickets/new">{vi.nav.newRequest}</Link> : undefined}
      />

      <section className="card attention" aria-labelledby="attention-h">
        <div className="card-head">
          <h2 id="attention-h" data-count={attentionAll.length}>{staff ? vi.dashboard.attentionStaff : vi.dashboard.attentionRequester}</h2>
          <Link to={listPath}>{vi.dashboard.openAll}</Link>
        </div>
        <p className="muted small">{staff ? vi.dashboard.attentionStaffHint : vi.dashboard.attentionRequesterHint}</p>
        {attention.length === 0 ? <EmptyState title={vi.dashboard.attentionEmpty} /> : <RecordList rows={attention.map(row)} />}
      </section>

      <h2 className="section-label">{vi.dashboard.summary}</h2>
      <section aria-label={vi.dashboard.summary} className="tiles">
        {tiles.map((tile) => <Tile key={tile.key} testId={`tile-${tile.key}`} label={tile.label} value={tile.value} tone={stateTone(tile.key)} to={tile.to} />)}
      </section>
      <p className={truncated ? "scope-note warn" : "scope-note"} data-testid="scope-note">
        {truncated ? vi.dashboard.scopeLimited(items.length, total) : vi.dashboard.scopeExact(total)}
      </p>

      <section className="card" aria-labelledby="recent-h">
        <div className="card-head">
          <h2 id="recent-h">{vi.dashboard.recent}</h2>
        </div>
        {recent.length === 0 ? <EmptyState title={vi.dashboard.recentEmpty} /> : <RecordList rows={recent.map(row)} />}
      </section>
    </>
  );
}
