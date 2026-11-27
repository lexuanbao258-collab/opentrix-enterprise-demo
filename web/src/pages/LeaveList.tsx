// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collect, hrApi } from "../api/client";
import type { LeaveRequest, Page } from "../api/types";
import { useHr } from "../auth/AuthContext";
import { Alert, Button, EmptyState, PageHeader, Pagination, Spinner, StatusBadge, TableWrap } from "../components/ui";
import { messageFor } from "../domain/errors";
import { formatDate, formatDateTime, shortId } from "../domain/format";
import { leaveStateLabel } from "../domain/leave";
import { useDebounced, useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

const LIMIT = 20;
const CAP = 500;

/**
 * "mine": the caller's own requests. "approvals": requests waiting for a decision. "all": every request the caller may read.
 * API v1 has no filter by owner or state, so these scan up to 500 authorized records (and say so when truncated).
 * Only an employee-only caller, whom the Platform already restricts to own records, is paged on the server.
 */
export function LeaveList({ mode }: { mode: "mine" | "approvals" | "all" }) {
  const { hr, user } = useHr();
  const ops = hr.leave.allowedOperations;
  const [text, setText] = useState("");
  const [params] = useSearchParams();
  const [state, setState] = useState(params.get("state") ?? "");
  const [offset, setOffset] = useState(0);
  const q = useDebounced(text.trim());
  useEffect(() => setOffset(0), [q, state]);
  const serverPaged = mode === "mine" && ops.read === "own" && !state;

  const result = useLoad<{ page: Page<LeaveRequest>; truncated: boolean }>(async () => {
    if (serverPaged) {
      return { page: await hrApi.list<LeaveRequest>("leaveRequest", { q: q || undefined, limit: LIMIT, offset }), truncated: false };
    }
    const all = await collect<LeaveRequest>("leaveRequest", { q: q || undefined, cap: CAP, client: hrApi });
    const items = all.items.filter(
      (item) => (mode !== "mine" || item.createdBy === user.id) && (mode === "approvals" ? item.state === "PENDING" : !state || item.state === state),
    );
    return { page: { items: items.slice(offset, offset + LIMIT), total: items.length, limit: LIMIT, offset }, truncated: all.truncated };
  }, [q, state, offset, mode]);

  const states = hr.leave.workflow?.states ?? [];
  const title = mode === "mine" ? vi.nav.hrMine : mode === "approvals" ? vi.nav.hrApprovals : vi.nav.hrAll;
  const subtitle = mode === "mine" ? vi.leave.emptyMineHint : mode === "approvals" ? vi.leave.approvalsHint : vi.leave.allHint;
  const filtered = Boolean(q) || Boolean(state);
  const empty = mode === "mine" ? vi.leave.emptyMine : mode === "approvals" ? vi.leave.emptyApprovals : vi.leave.emptyAll;
  const note = result.data?.truncated ? <Alert tone="warning">{vi.hrDashboard.scopeLimited(CAP, CAP)}</Alert> : null;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={ops.create ? <Link className="btn btn-primary" to="/hr/requests/new">{vi.nav.hrNew}</Link> : undefined} />
      <div className="toolbar" role="search">
        <div className="search-box">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label={vi.leave.searchLabel} placeholder={vi.leave.searchLabel} value={text} maxLength={100} onChange={(event) => setText(event.target.value)} />
        </div>
        {mode !== "approvals" && (
          <div className="select-inline">
            <label htmlFor="state-filter">{vi.leave.filterState}</label>
            <select id="state-filter" value={state} onChange={(event) => setState(event.target.value)}>
              <option value="">{vi.common.all}</option>
              {states.map((item) => <option key={item.id} value={item.id}>{leaveStateLabel(hr, item.id)}</option>)}
            </select>
          </div>
        )}
      </div>

      {result.error ? (
        <Alert tone="error" actions={<Button onClick={result.reload}>{vi.common.retry}</Button>}>{messageFor(result.error)}</Alert>
      ) : result.loading && !result.data ? (
        <Spinner />
      ) : result.data && result.data.page.items.length === 0 ? (
        <>
          {note}
          <EmptyState
            title={filtered ? vi.leave.emptyAll : empty}
            hint={!filtered && mode === "mine" ? vi.leave.emptyMineHint : undefined}
            action={!filtered && mode === "mine" && ops.create ? <Link className="btn btn-primary" to="/hr/requests/new">{vi.nav.hrNew}</Link> : undefined}
          />
        </>
      ) : (
        result.data && (
          <>
            {note}
            <TableWrap label={title} busy={result.loading}>
              <table className="table responsive">
                <caption className="sr-only">{title}</caption>
                <thead>
                  <tr>
                    <th scope="col">{vi.leave.kind}</th><th scope="col">{vi.leave.startDate}</th>
                    <th scope="col" className="num">{vi.leave.days}</th><th scope="col">{vi.leave.owner}</th><th scope="col">{vi.leave.state}</th>
                    <th scope="col">{vi.common.updated}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.page.items.map((item) => (
                    <tr key={item.id} data-own={item.createdBy === user.id}>
                      <td data-label={vi.leave.kind} className="cell-title">
                        <Link to={`/hr/requests/${item.id}`}>{vi.leave.kinds[item.data.kind] ?? item.data.kind}</Link>
                        <span className="cell-sub">{vi.leave.code} <code>{shortId(item.id)}</code></span>
                      </td>
                      <td data-label={vi.leave.startDate}>{formatDate(item.data.startDate)}</td>
                      <td data-label={vi.leave.days} className="num">{item.data.days}</td>
                      <td data-label={vi.leave.owner} title={item.createdBy === user.id ? undefined : `…${item.createdBy.slice(-6)}`}>{item.createdBy === user.id ? vi.leave.you : vi.leave.otherEmployee}</td>
                      <td data-label={vi.leave.state}><StatusBadge state={item.state} label={leaveStateLabel(hr, item.state)} /></td>
                      <td data-label={vi.common.updated} className="nowrap">{formatDateTime(item.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pagination offset={result.data.page.offset} limit={LIMIT} total={result.data.page.total} onChange={setOffset} />
          </>
        )
      )}
    </>
  );
}
