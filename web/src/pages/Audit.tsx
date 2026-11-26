// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useReady } from "../auth/AuthContext";
import { Alert, Button, EmptyState, PageHeader, Pagination, Spinner, TableWrap } from "../components/ui";
import { messageFor } from "../domain/errors";
import { formatDateTime, shortId } from "../domain/format";
import { stateLabel, transitionLabel } from "../domain/tickets";
import { useDebounced, useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

const LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only reachable when the backend grants the `audit` operation on tickets (administrators). */
export function Audit() {
  const { caps } = useReady();
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const debounced = useDebounced(filter.trim());
  const recordId = UUID.test(debounced) ? debounced : undefined;
  useEffect(() => setOffset(0), [recordId]);
  const data = useLoad(() => api.audit("ticket", { recordId, limit: LIMIT, offset }), [recordId, offset]);

  return (
    <>
      <PageHeader title={vi.audit.title} subtitle={vi.audit.subtitle} />
      <div className="toolbar">
        <div className="search-box">
          <input
            type="search" aria-label={vi.audit.filterRecord} placeholder={vi.audit.filterRecord} value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>
      {data.error ? (
        <Alert tone="error" actions={<Button onClick={data.reload}>{vi.common.retry}</Button>}>{messageFor(data.error)}</Alert>
      ) : data.loading && !data.data ? (
        <Spinner />
      ) : data.data && data.data.items.length === 0 ? (
        <EmptyState title={vi.audit.empty} />
      ) : (
        data.data && (
          <>
            <TableWrap label={vi.audit.title}>
              <table className="table responsive">
                <caption className="sr-only">{vi.audit.title}</caption>
                <thead>
                  <tr>
                    <th scope="col">{vi.audit.time}</th><th scope="col">{vi.audit.action}</th><th scope="col">{vi.audit.record}</th>
                    <th scope="col">{vi.audit.actor}</th><th scope="col">{vi.audit.change}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.items.map((item) => (
                    <tr key={item.eventId}>
                      <td data-label={vi.audit.time}>{formatDateTime(item.occurredAt)}</td>
                      <td data-label={vi.audit.action}>{vi.audit.actions[item.action] ?? item.action}</td>
                      <td data-label={vi.audit.record}><code>{shortId(item.recordId)}</code></td>
                      <td data-label={vi.audit.actor}>{item.actorType === "MACHINE" ? vi.ticket.machine : "…" + item.actorId.slice(-6)}</td>
                      <td data-label={vi.audit.change}>
                        {item.transitionId
                          ? `${transitionLabel(caps, item.transitionId)}: ${stateLabel(caps, item.fromState)} → ${stateLabel(caps, item.toState)}`
                          : item.after ? JSON.stringify(item.after) : item.before ? JSON.stringify(item.before) : vi.common.none}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pagination offset={offset} limit={LIMIT} total={data.data.total} onChange={setOffset} />
          </>
        )
      )}
    </>
  );
}
