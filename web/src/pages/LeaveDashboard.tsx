// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { Link } from "react-router-dom";
import { collect, hrApi } from "../api/client";
import type { LeaveRequest } from "../api/types";
import { useHr } from "../auth/AuthContext";
import { RecordList } from "../components/RecordList";
import { Alert, Button, EmptyState, PageHeader, Spinner, StatusBadge, Tile, stateTone } from "../components/ui";
import { messageFor } from "../domain/errors";
import { formatDate, formatDateTime } from "../domain/format";
import { leaveStateLabel } from "../domain/leave";
import { byRecent, countByState } from "../domain/tickets";
import { useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

const CAP = 500;
const SHOWN = 5;

export function LeaveDashboard() {
  const { hr, user } = useHr();
  const ops = hr.leave.allowedOperations;
  const staff = ops.read === "all";
  const manager = hr.has("manager");
  const data = useLoad(() => collect<LeaveRequest>("leaveRequest", { cap: CAP, client: hrApi }), []);

  if (data.loading && !data.data) return <Spinner />;
  if (data.error) {
    return <Alert tone="error" title={vi.errors.generic} actions={<Button onClick={data.reload}>{vi.common.retry}</Button>}>{messageFor(data.error)}</Alert>;
  }
  const { items, total, truncated } = data.data!;
  const counts = countByState(items).byState;
  const n = (state: string) => counts[state] ?? 0;
  const listPath = ops.create && !staff ? "/hr/my-requests" : "/hr/requests";
  const link = (state: string) => `${listPath}?state=${state}`;
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

  // A manager decides pending requests, an employee follows drafts and pending requests, an auditor only watches pending ones.
  const attentionStates = manager || staff ? ["PENDING"] : ["DRAFT", "PENDING"];
  const attentionAll = items.filter((item) => attentionStates.includes(item.state ?? ""));
  const attention = [...attentionAll].sort(byRecent).slice(0, SHOWN);
  const shown = new Set(attention.map((item) => item.id));
  const recent = items.filter((item) => !shown.has(item.id)).sort(byRecent).slice(0, SHOWN);
  const copy = manager
    ? { title: vi.hrDashboard.attentionManager, hint: vi.hrDashboard.attentionManagerHint, path: "/hr/approvals" }
    : staff
      ? { title: vi.hrDashboard.attentionAuditor, hint: vi.hrDashboard.attentionAuditorHint, path: listPath }
      : { title: vi.hrDashboard.attentionEmployee, hint: vi.hrDashboard.attentionEmployeeHint, path: listPath };
  const row = (record: (typeof items)[number]) => ({
    id: record.id, to: `/hr/requests/${record.id}`,
    title: `${vi.leave.kinds[record.data.kind] ?? record.data.kind} · ${vi.leave.daysUnit(record.data.days)}`,
    meta: `${vi.leave.startDate}: ${formatDate(record.data.startDate)} · ${record.createdBy === user.id ? vi.leave.you : vi.leave.otherEmployee} · ${formatDateTime(record.updatedAt)}`,
    badges: <StatusBadge state={record.state} label={leaveStateLabel(hr, record.state)} />,
  });

  return (
    <>
      <PageHeader
        title={vi.hrDashboard.title}
        subtitle={staff ? vi.hrDashboard.subtitleStaff : vi.hrDashboard.subtitleEmployee}
        actions={ops.create ? <Link className="btn btn-primary" to="/hr/requests/new">{vi.nav.hrNew}</Link> : undefined}
      />

      <section className="card attention" aria-labelledby="attention-h">
        <div className="card-head">
          <h2 id="attention-h" data-count={attentionAll.length}>{copy.title}</h2>
          <Link to={copy.path}>{vi.hrDashboard.openAll}</Link>
        </div>
        <p className="muted small">{copy.hint}</p>
        {attention.length === 0 ? <EmptyState title={vi.hrDashboard.attentionEmpty} /> : <RecordList rows={attention.map(row)} />}
      </section>

      <h2 className="section-label">{vi.hrDashboard.summary}</h2>
      <section aria-label={vi.hrDashboard.summary} className="tiles">
        {tiles.map((tile) => <Tile key={tile.key} testId={`tile-${tile.key}`} label={tile.label} value={tile.value} tone={stateTone(tile.key)} to={link(tile.key)} />)}
      </section>
      <p className={truncated ? "scope-note warn" : "scope-note"} data-testid="scope-note">
        {truncated ? vi.hrDashboard.scopeLimited(items.length, total) : vi.hrDashboard.scopeExact(total)}
      </p>

      <section className="card" aria-labelledby="recent-h">
        <div className="card-head">
          <h2 id="recent-h">{vi.hrDashboard.recent}</h2>
        </div>
        {recent.length === 0 ? <EmptyState title={vi.hrDashboard.recentEmpty} /> : <RecordList rows={recent.map(row)} />}
      </section>
    </>
  );
}
