// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { HistoryItem, PlatformRecord, Ticket, WorkflowInfo } from "../api/types";
import { useReady } from "../auth/AuthContext";
import { ActionPanel, StatusBanner, TechInfo } from "../components/Detail";
import { HistoryTimeline } from "../components/History";
import { Alert, Button, ConfirmDialog, EmptyState, PageHeader, PriorityBadge, Spinner } from "../components/ui";
import { isConflict, isUnknownOutcome, messageFor } from "../domain/errors";
import { formatDateTime, shortId } from "../domain/format";
import { categoryName, stateLabel, transitionLabel } from "../domain/tickets";
import { useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

interface Bundle { record: PlatformRecord<Ticket>; workflow: WorkflowInfo; history: HistoryItem[] }
type Confirm = { kind: "delete" } | { kind: "transition"; action: string };

/** Transitions that end the ticket: separated from forward actions and confirmed first. */
const ENDING = new Set(["cancel", "discard"]);

export function TicketDetail() {
  const { id = "" } = useParams();
  const { caps, categories } = useReady();
  const navigate = useNavigate();
  const location = useLocation();
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [unknown, setUnknown] = useState<{ action: string; fromVersion: number } | null>(null);

  const data = useLoad<Bundle>(async () => {
    const [record, workflow, history] = await Promise.all([api.get<Ticket>("ticket", id), api.workflow("ticket", id), api.history("ticket", id)]);
    return { record, workflow, history };
  }, [id]);
  useEffect(() => { if (flash) window.history.replaceState({}, ""); }, [flash]);

  if (data.loading && !data.data) return <Spinner />;
  if (data.error) {
    const missing = data.error instanceof ApiError && (data.error.status === 404 || data.error.status === 400);
    return missing
      ? <EmptyState title={vi.ticket.notFoundTitle} hint={vi.ticket.notFoundBody} action={<Link className="btn" to="/">{vi.common.back}</Link>} />
      : <Alert tone="error" actions={<Button onClick={data.reload}>{vi.common.retry}</Button>}>{messageFor(data.error)}</Alert>;
  }
  const { record, workflow, history } = data.data!;
  const ops = caps.ticket.allowedOperations;
  const canEdit = workflow.editable && Boolean(ops.update);
  const canDelete = workflow.editable && Boolean(ops.delete);

  async function reload(message?: string) {
    setFailure(null);
    if (message) setFlash(message);
    data.reload();
  }

  async function runTransition(action: string) {
    setBusy(action);
    setFailure(null);
    setFlash(null);
    try {
      await api.transition("ticket", id, action, record.version);
      setUnknown(null);
      setFlash(vi.ticket.transitioned(transitionLabel(caps, action)));
      data.reload();
    } catch (error) {
      if (isUnknownOutcome(error)) setUnknown({ action, fromVersion: record.version });
      setFailure(error);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  /** Reconcile by reading. The write is never repeated automatically. */
  async function check() {
    if (!unknown) return;
    setBusy("check");
    try {
      const fresh = await api.get<Ticket>("ticket", id);
      if (fresh.version > unknown.fromVersion) {
        setUnknown(null);
        setFailure(null);
        setFlash(vi.errors.unknownResolvedApplied);
      } else {
        setFlash(vi.errors.unknownResolvedPending);
      }
      data.reload();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      await api.remove("ticket", id, record.version);
      navigate(ops.read === "all" ? "/tickets" : "/my-requests", { state: { flash: vi.ticket.deleted } });
    } catch (error) {
      setConfirm(null);
      setFailure(error);
    } finally {
      setBusy(null);
    }
  }

  const transitions = workflow.allowedActions;
  const conflict = isConflict(failure);
  const onAction = (action: string) => (ENDING.has(action) ? setConfirm({ kind: "transition", action }) : void runTransition(action));
  const dialog = confirm?.kind === "transition"
    ? { title: transitionLabel(caps, confirm.action), message: vi.ticket.confirm[confirm.action] ?? "", label: transitionLabel(caps, confirm.action), busy: busy === confirm.action, run: () => void runTransition(confirm.action) }
    : { title: vi.common.delete, message: vi.ticket.deleteConfirm, label: vi.common.delete, busy: busy === "delete", run: () => void remove() };

  return (
    <>
      <PageHeader
        title={record.data.title}
        subtitle={`${vi.ticket.singular} ${shortId(record.id)}`}
        actions={canEdit ? <Link className="btn" to={`/tickets/${record.id}/edit`}><Pencil size={16} aria-hidden="true" />{vi.common.edit}</Link> : undefined}
      />
      {flash && <Alert tone="success" onClose={() => setFlash(null)}>{flash}</Alert>}
      {failure != null && (
        <Alert
          tone={isUnknownOutcome(failure) ? "warning" : "error"}
          title={isUnknownOutcome(failure) ? vi.errors.unknownTitle : undefined}
          actions={
            isUnknownOutcome(failure)
              ? <Button busy={busy === "check"} onClick={() => void check()}>{vi.errors.unknownCheck}</Button>
              : conflict ? <Button onClick={() => void reload()}>{vi.common.reload}</Button> : undefined
          }
          onClose={isUnknownOutcome(failure) ? undefined : () => setFailure(null)}
        >
          {messageFor(failure)}
        </Alert>
      )}
      <StatusBanner state={record.state} label={stateLabel(caps, record.state)} hint={vi.ticket.stateHint[record.state ?? ""]} />

      <div className="detail-grid">
        <section className="card area-info" aria-labelledby="info-h">
          <h2 id="info-h" className="sr-only">{vi.ticket.singular}</h2>
          <dl className="props">
            <div><dt>{vi.ticket.priority}</dt><dd><PriorityBadge priority={record.data.priority} label={vi.priority[record.data.priority] ?? record.data.priority} /></dd></div>
            <div><dt>{vi.ticket.category}</dt><dd>{categoryName(categories, record.data.categoryCode) ?? record.data.categoryCode}</dd></div>
            <div><dt>{vi.common.created}</dt><dd>{formatDateTime(record.createdAt)}</dd></div>
            <div><dt>{vi.common.updated}</dt><dd>{formatDateTime(record.updatedAt)}</dd></div>
          </dl>
          <h3>{vi.ticket.description}</h3>
          <p className="prose">{record.data.description}</p>
          <TechInfo id={record.id} version={record.version} idLabel={vi.common.fullId} versionLabel={vi.ticket.version} />
        </section>

        <ActionPanel
          actions={transitions} ending={ENDING} labelOf={(action) => transitionLabel(caps, action)} busy={busy} locked={unknown !== null}
          emptyText={workflow.terminal ? vi.ticket.locked : vi.ticket.noActions} onAction={onAction}
          onDelete={canDelete ? () => setConfirm({ kind: "delete" }) : undefined}
        >
          {!workflow.editable && !workflow.terminal && Boolean(ops.update || ops.delete) && <p className="muted small action-note">{vi.ticket.locked}</p>}
        </ActionPanel>

        <section className="card area-history" aria-labelledby="history-h">
          <h2 id="history-h">{vi.ticket.history}</h2>
          {history.length === 0 ? (
            <p className="muted">{vi.ticket.historyEmpty}</p>
          ) : (
            <HistoryTimeline
              history={history} createdBy={record.createdBy} stateName={(state) => stateLabel(caps, state)}
              transitionName={(id) => transitionLabel(caps, id)}
              labels={{ createdBy: vi.ticket.createdBy, handledBy: vi.ticket.handledBy, machine: vi.ticket.machine }}
            />
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirm !== null} title={dialog.title} message={dialog.message} confirmLabel={dialog.label}
        busy={dialog.busy} onConfirm={dialog.run} onCancel={() => setConfirm(null)}
      />
    </>
  );
}
