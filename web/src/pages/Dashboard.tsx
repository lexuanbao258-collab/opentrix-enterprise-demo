// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { Link } from "react-router-dom";
import { collect } from "../api/client";
import type { Ticket } from "../api/types";
import { useReady } from "../auth/AuthContext";
import { Alert, Button, EmptyState, PageHeader, PriorityBadge, Spinner, StatusBadge } from "../components/ui";
import { messageFor } from "../domain/errors";
import { formatDateTime } from "../domain/format";
import { categoryName, countByState, stateLabel } from "../domain/tickets";
import { useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

const CAP = 500;

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
  const tiles = staff
    ? [
        { key: "SUBMITTED", label: vi.dashboard.waiting, value: n("SUBMITTED") },
        { key: "IN_PROGRESS", label: vi.dashboard.working, value: n("IN_PROGRESS") },
        { key: "RESOLVED", label: vi.dashboard.awaitingConfirm, value: n("RESOLVED") },
        { key: "CLOSED", label: vi.dashboard.closed, value: n("CLOSED") },
      ]
    : [
        { key: "DRAFT", label: vi.dashboard.drafts, value: n("DRAFT") },
        { key: "SUBMITTED", label: vi.dashboard.submitted, value: n("SUBMITTED") + n("IN_PROGRESS") },
        { key: "RESOLVED", label: vi.dashboard.resolved, value: n("RESOLVED") },
        { key: "CLOSED", label: vi.dashboard.closed, value: n("CLOSED") },
      ];
  const listPath = staff ? "/tickets" : "/my-requests";
  const recent = items.slice(0, 5);

  return (
    <>
      <PageHeader
        title={vi.dashboard.title}
        subtitle={staff ? vi.dashboard.subtitleStaff : vi.dashboard.subtitleRequester}
        actions={caps.ticket.allowedOperations.create ? <Link className="btn btn-primary" to="/tickets/new">{vi.nav.newRequest}</Link> : undefined}
      />
      <section aria-label={vi.dashboard.title} className="tiles">
        {tiles.map((tile) => (
          <div className="tile" key={tile.key} data-testid={`tile-${tile.key}`}>
            <span className="tile-label">{tile.label}</span>
            <strong className="tile-value">{tile.value}</strong>
          </div>
        ))}
      </section>
      <p className={truncated ? "scope-note warn" : "scope-note"} data-testid="scope-note">
        {truncated ? vi.dashboard.scopeLimited(items.length, total) : vi.dashboard.scopeExact(total)}
      </p>

      <section className="card" aria-labelledby="recent-h">
        <div className="card-head">
          <h2 id="recent-h">{vi.dashboard.recent}</h2>
          <Link to={listPath}>{vi.dashboard.openAll}</Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState title={vi.dashboard.recentEmpty} />
        ) : (
          <ul className="recent-list">
            {recent.map((item) => (
              <li key={item.id}>
                <div className="recent-main">
                  <Link to={`/tickets/${item.id}`}>{item.data.title}</Link>
                  <span className="muted">{categoryName(categories, item.data.categoryCode) ?? item.data.categoryCode} · {formatDateTime(item.updatedAt)}</span>
                </div>
                <PriorityBadge priority={item.data.priority} label={vi.priority[item.data.priority] ?? item.data.priority} />
                <StatusBadge state={item.state} label={stateLabel(caps, item.state)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
