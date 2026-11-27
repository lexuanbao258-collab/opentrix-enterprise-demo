// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, collect } from "../api/client";
import type { Page, Ticket } from "../api/types";
import { useReady } from "../auth/AuthContext";
import { Alert, Button, EmptyState, PageHeader, Pagination, PriorityBadge, Spinner, StatusBadge, TableWrap } from "../components/ui";
import { messageFor } from "../domain/errors";
import { formatDateTime, shortId } from "../domain/format";
import { categoryName, stateLabel } from "../domain/tickets";
import { useDebounced, useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

const LIMIT = 20;
const CAP = 500;

/**
 * "mine": the caller's own tickets (the backend only returns what the caller may read).
 * "queue": every ticket the caller may read (agents, administrators).
 * Without a state filter, search and paging run on the server. A state filter has no server support in API v1,
 * so it scans up to 500 authorized records and says so when it is truncated.
 */
export function TicketList({ mode }: { mode: "mine" | "queue" }) {
  const { caps, categories } = useReady();
  const [text, setText] = useState("");
  const [params] = useSearchParams();
  const [state, setState] = useState(params.get("state") ?? "");
  const [offset, setOffset] = useState(0);
  const q = useDebounced(text.trim());
  useEffect(() => setOffset(0), [q, state]);

  const result = useLoad<{ page: Page<Ticket>; truncated: boolean; filtered: boolean }>(async () => {
    if (!state) {
      const page = await api.list<Ticket>("ticket", { q: q || undefined, limit: LIMIT, offset });
      return { page, truncated: false, filtered: false };
    }
    const all = await collect<Ticket>("ticket", { q: q || undefined, cap: CAP });
    const items = all.items.filter((item) => item.state === state);
    return { page: { items: items.slice(offset, offset + LIMIT), total: items.length, limit: LIMIT, offset }, truncated: all.truncated, filtered: true };
  }, [q, state, offset]);

  const states = caps.ticket.workflow?.states ?? [];
  const title = mode === "mine" ? vi.nav.myRequests : vi.nav.tickets;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={mode === "mine" ? vi.ticket.emptyMineHint : vi.dashboard.subtitleStaff}
        actions={caps.ticket.allowedOperations.create ? <Link className="btn btn-primary" to="/tickets/new">{vi.nav.newRequest}</Link> : undefined}
      />
      <div className="toolbar" role="search">
        <div className="search-box">
          <Search size={16} aria-hidden="true" />
          <input
            type="search" aria-label={vi.ticket.searchLabel} placeholder={vi.ticket.searchLabel} value={text} maxLength={100}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="select-inline">
          <label htmlFor="state-filter">{vi.ticket.filterState}</label>
          <select id="state-filter" value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">{vi.common.all}</option>
            {states.map((item) => <option key={item.id} value={item.id}>{stateLabel(caps, item.id)}</option>)}
          </select>
        </div>
      </div>

      {result.error ? (
        <Alert tone="error" actions={<Button onClick={result.reload}>{vi.common.retry}</Button>}>{messageFor(result.error)}</Alert>
      ) : result.loading && !result.data ? (
        <Spinner />
      ) : result.data && result.data.page.items.length === 0 ? (
        <EmptyState
          title={!q && !state && mode === "mine" ? vi.ticket.emptyMine : vi.ticket.emptyAll}
          hint={!q && !state && mode === "mine" ? vi.ticket.emptyMineHint : undefined}
          action={!q && !state && caps.ticket.allowedOperations.create ? <Link className="btn btn-primary" to="/tickets/new">{vi.nav.newRequest}</Link> : undefined}
        />
      ) : (
        result.data && (
          <>
            {result.data.truncated && <Alert tone="warning">{vi.dashboard.scopeLimited(CAP, CAP)}</Alert>}
            <TableWrap label={title} busy={result.loading}>
              <table className="table responsive">
                <caption className="sr-only">{title}</caption>
                <thead>
                  <tr>
                    <th scope="col">{vi.ticket.title}</th><th scope="col">{vi.ticket.category}</th>
                    <th scope="col">{vi.ticket.priority}</th><th scope="col">{vi.ticket.state}</th><th scope="col">{vi.common.updated}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.page.items.map((item) => (
                    <tr key={item.id}>
                      <td data-label={vi.ticket.title} className="cell-title">
                        <Link to={`/tickets/${item.id}`}>{item.data.title}</Link>
                        <span className="cell-sub">{vi.ticket.code} <code>{shortId(item.id)}</code></span>
                      </td>
                      <td data-label={vi.ticket.category}>{categoryName(categories, item.data.categoryCode) ?? item.data.categoryCode}</td>
                      <td data-label={vi.ticket.priority}><PriorityBadge priority={item.data.priority} label={vi.priority[item.data.priority] ?? item.data.priority} /></td>
                      <td data-label={vi.ticket.state}><StatusBadge state={item.state} label={stateLabel(caps, item.state)} /></td>
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
