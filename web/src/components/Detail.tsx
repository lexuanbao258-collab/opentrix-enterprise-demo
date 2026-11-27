// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { vi } from "../i18n/vi";
import { Button, StatusBadge, stateTone } from "./ui";

/** Current state, big and first, with a plain-language line about what happens next. Shared by every module. */
export function StatusBanner({ state, label, hint }: { state: string | null; label: string; hint?: string }) {
  return (
    <div className="status-banner" data-tone={stateTone(state)} data-testid="status-banner">
      <StatusBadge state={state} label={label} large />
      {hint && <p className="status-text">{hint}</p>}
    </div>
  );
}

/** Actions come only from the workflow's allowedActions. Ending actions (cancel, reject, ...) are separated and never primary. */
export function ActionPanel({
  actions, ending, labelOf, busy, locked, emptyText, onAction, onDelete, children,
}: {
  actions: { id: string }[];
  ending: ReadonlySet<string>;
  labelOf: (id: string) => string;
  busy: string | null;
  locked: boolean;
  emptyText: string;
  onAction: (id: string) => void;
  onDelete?: () => void;
  children?: ReactNode;
}) {
  const forward = actions.filter((action) => !ending.has(action.id));
  const stopping = actions.filter((action) => ending.has(action.id));
  const disabled = busy !== null || locked;
  return (
    <section className="card area-actions" aria-labelledby="actions-h">
      <h2 id="actions-h">{vi.common.actionsTitle}</h2>
      {actions.length === 0 && !onDelete && <p className="muted">{emptyText}</p>}
      {forward.length > 0 && (
        <div className="action-stack">
          {forward.map((action, index) => (
            <Button key={action.id} variant={index === 0 ? "primary" : "secondary"} busy={busy === action.id} disabled={disabled} data-action={action.id} onClick={() => onAction(action.id)}>
              {labelOf(action.id)}
            </Button>
          ))}
        </div>
      )}
      {(stopping.length > 0 || onDelete) && (
        <div className={forward.length > 0 ? "action-divider" : undefined}>
          <p className="section-label">{vi.common.endingActions}</p>
          <div className="action-stack">
            {stopping.map((action) => (
              <Button key={action.id} variant="danger" busy={busy === action.id} disabled={disabled} data-action={action.id} onClick={() => onAction(action.id)}>
                {labelOf(action.id)}
              </Button>
            ))}
            {onDelete && <Button variant="danger" disabled={disabled} onClick={onDelete}><Trash2 size={16} aria-hidden="true" />{vi.common.delete}</Button>}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}

/** Identifiers and the optimistic-locking version: available when needed, folded away for everyday use. */
export function TechInfo({ id, version, versionLabel, idLabel }: { id: string; version: number; versionLabel: string; idLabel: string }) {
  return (
    <details className="tech">
      <summary>{vi.common.techInfo}</summary>
      <dl className="props">
        <div><dt>{idLabel}</dt><dd><code>{id}</code></dd></div>
        <div><dt>{versionLabel}</dt><dd>{version}</dd></div>
      </dl>
    </details>
  );
}
