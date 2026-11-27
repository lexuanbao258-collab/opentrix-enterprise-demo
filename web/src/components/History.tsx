// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import type { HistoryItem } from "../api/types";
import { formatDateTime } from "../domain/format";
import { vi } from "../i18n/vi";

export interface HistoryLabels {
  createdBy: string;
  handledBy: string;
  machine: string;
}

/** Workflow history of one record. Shared by every ESM module; only the labels differ. */
export function HistoryTimeline({
  history, createdBy, stateName, transitionName, labels,
}: {
  history: HistoryItem[];
  createdBy: string;
  stateName: (state: string | null) => string;
  transitionName: (id: string) => string;
  labels: HistoryLabels;
}) {
  // The full actor id is not meaningful to people: the role label is shown and the id tail stays available as a tooltip.
  const actor = (item: HistoryItem) =>
    item.actorType === "MACHINE" ? labels.machine : item.actorId === createdBy ? labels.createdBy : labels.handledBy;
  return (
    <ol className="timeline">
      {history.map((item, index) => (
        <li key={`${item.recordVersion}-${index}`} data-testid="history-item">
          <span className="dot" aria-hidden="true" />
          <div>
            <strong>
              {item.transitionId ? transitionName(item.transitionId) : vi.audit.actions[item.action] ?? item.action}
              {item.toState && <> → {stateName(item.toState)}</>}
            </strong>
            <span className="muted"><span title={`…${item.actorId.slice(-6)}`}>{actor(item)}</span> · {formatDateTime(item.occurredAt)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
