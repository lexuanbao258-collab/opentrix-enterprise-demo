// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { Link } from "react-router-dom";
import { collect, hrApi } from "../api/client";
import type { LeaveRequest } from "../api/types";
import { useHr } from "../auth/AuthContext";
import { Alert, Button, EmptyState, PageHeader, Spinner, StatusBadge } from "../components/ui";
import { messageFor } from "../domain/errors";
import { formatDate, formatDateTime } from "../domain/format";
import { leaveStateLabel } from "../domain/leave";
import { countByState } from "../domain/tickets";
import { useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

const CAP = 500;

export function LeaveDashboard() {
  const { hr } = useHr();
  const ops = hr.leave.allowedOperations;
  const staff = ops.read === "all";
  const data = useLoad(() => collect<LeaveRequest>("leaveRequest", { cap: CAP, client: hrApi }), []);

  if (data.loading && !data.data) return <Spinner />;
  if (data.error) {
    return <Alert tone="error" title={vi.errors.generic} actions={<Button onClick={data.reload}>{vi.common.retry}</Button>}>{messageFor(data.error)}</Alert>;
  }
  const { items, total, truncated } = data.data!;
  const counts = countByState(items).byState;
  const n = (state: string) => counts[state] ?? 0;
  const tiles = staff
    ? [
        { key: "PENDING", label: vi.hrDashboard.pending, value: n("PENDING") },
        { key: "APPROVED", label: vi.hrDashboard.approved, value: n("APPROVED") },
        { key: "REJECTED", label: vi.hrDashboard.rejected, value: n("REJECTED") },
        { key: "CANCELLED", label: vi.hrDashboard.cancelled, value: n("CANCELLED") },
      ]
    : [
        { key: "DRAFT", label: vi.hrDashboard.drafts, value: n("DRAFT") },
        { key: "PENDING", label: vi.hrDashboard.pending, value: n("PENDING") },
        { key: "APPROVED", label: vi.hrDashboard.approved, value: n("APPROVED") },
        { key: "REJECTED", label: vi.hrDashboard.rejected, value: n("REJECTED") },
      ];
  const listPath = ops.create && !staff ? "/hr/my-requests" : "/hr/requests";
  const recent = items.slice(0, 5);

  return (
    <>
      <PageHeader
        title={vi.hrDashboard.title}
        subtitle={staff ? vi.hrDashboard.subtitleStaff : vi.hrDashboard.subtitleEmployee}
        actions={ops.create ? <Link className="btn btn-primary" to="/hr/requests/new">{vi.nav.hrNew}</Link> : undefined}
      />
      <section aria-label={vi.hrDashboard.title} className="tiles">
        {tiles.map((tile) => (
          <div className="tile" key={tile.key} data-testid={`tile-${tile.key}`}>
            <span className="tile-label">{tile.label}</span>
            <strong className="tile-value">{tile.value}</strong>
          </div>
        ))}
      </section>
      <p className={truncated ? "scope-note warn" : "scope-note"} data-testid="scope-note">
        {truncated ? vi.hrDashboard.scopeLimited(items.length, total) : vi.hrDashboard.scopeExact(total)}
      </p>

      <section className="card" aria-labelledby="recent-h">
        <div className="card-head">
          <h2 id="recent-h">{vi.hrDashboard.recent}</h2>
          <Link to={listPath}>{vi.hrDashboard.openAll}</Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState title={vi.hrDashboard.recentEmpty} />
        ) : (
          <ul className="recent-list">
            {recent.map((item) => (
              <li key={item.id}>
                <div className="recent-main">
                  <Link to={`/hr/requests/${item.id}`}>{vi.leave.kinds[item.data.kind] ?? item.data.kind} · {vi.leave.daysUnit(item.data.days)}</Link>
                  <span className="muted">{formatDate(item.data.startDate)} · {formatDateTime(item.updatedAt)}</span>
                </div>
                <StatusBadge state={item.state} label={leaveStateLabel(hr, item.state)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
