// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { api, type AppApi } from "../api/client";
import { useReady } from "../auth/AuthContext";
import { Alert, Button, EmptyState, PageHeader, Pagination, Spinner, TableWrap } from "../components/ui";
import { messageFor } from "../domain/errors";
import { formatDateTime, shortId } from "../domain/format";
import { stateLabel, transitionLabel } from "../domain/tickets";
import { useDebounced, useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

const LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditLogProps {
  client: AppApi;
  entity: string;
  title: string;
  subtitle: string;
  filterLabel: string;
  recordHeader: string;
  stateName: (state: string | null) => string;
  transitionName: (id: string) => string;
  machineLabel: string;
}

/**
 * Audit trail of one entity, as the Platform returns it (sensitive values are already redacted server-side).
 * Shared by every ESM module; only reachable where the backend grants the `audit` operation.
 */
export function AuditLog(props: AuditLogProps) {
  const { client, entity } = props;
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const debounced = useDebounced(filter.trim());
  const recordId = UUID.test(debounced) ? debounced : undefined;
  useEffect(() => setOffset(0), [recordId]);
  const data = useLoad(() => client.audit(entity, { recordId, limit: LIMIT, offset }), [recordId, offset]);

  return (
    <>
      <PageHeader title={props.title} subtitle={props.subtitle} />
      <div className="toolbar">
        <div className="search-box">
          <input
            type="search" aria-label={props.filterLabel} placeholder={props.filterLabel} value={filter}
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
            <TableWrap label={props.title}>
              <table className="table responsive">
                <caption className="sr-only">{props.title}</caption>
                <thead>
                  <tr>
                    <th scope="col">{vi.audit.time}</th><th scope="col">{vi.audit.action}</th><th scope="col">{props.recordHeader}</th>
                    <th scope="col">{vi.audit.actor}</th><th scope="col">{vi.audit.change}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.items.map((item) => (
                    <tr key={item.eventId}>
                      <td data-label={vi.audit.time}>{formatDateTime(item.occurredAt)}</td>
                      <td data-label={vi.audit.action}>{vi.audit.actions[item.action] ?? item.action}</td>
                      <td data-label={props.recordHeader}><code>{shortId(item.recordId)}</code></td>
                      <td data-label={vi.audit.actor}>{item.actorType === "MACHINE" ? props.machineLabel : "…" + item.actorId.slice(-6)}</td>
                      <td data-label={vi.audit.change}>
                        {item.transitionId
                          ? `${props.transitionName(item.transitionId)}: ${props.stateName(item.fromState)} → ${props.stateName(item.toState)}`
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

/** IT Helpdesk: only reachable when the backend grants the `audit` operation on tickets (administrators). */
export function Audit() {
  const { caps } = useReady();
  return (
    <AuditLog
      client={api} entity="ticket" title={vi.audit.title} subtitle={vi.audit.subtitle} filterLabel={vi.audit.filterRecord}
      recordHeader={vi.audit.record} stateName={(state) => stateLabel(caps, state)} transitionName={(id) => transitionLabel(caps, id)}
      machineLabel={vi.ticket.machine}
    />
  );
}
