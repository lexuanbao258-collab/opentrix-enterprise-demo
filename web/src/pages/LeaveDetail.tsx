// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError, hrApi } from "../api/client";
import type { HistoryItem, LeaveRequest, PlatformRecord, WorkflowInfo } from "../api/types";
import { useHr } from "../auth/AuthContext";
import { ActionPanel, StatusBanner, TechInfo } from "../components/Detail";
import { HistoryTimeline } from "../components/History";
import { Alert, Button, ConfirmDialog, EmptyState, PageHeader, Spinner } from "../components/ui";
import { isConflict, isUnknownOutcome, messageFor } from "../domain/errors";
import { formatDate, formatDateTime, shortId } from "../domain/format";
import { leaveStateLabel, leaveTransitionLabel } from "../domain/leave";
import { useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

interface Bundle { record: PlatformRecord<LeaveRequest>; workflow: WorkflowInfo; history: HistoryItem[] }
type Confirm = { kind: "delete" } | { kind: "transition"; action: string };

/** Transitions that end the request: separated from forward actions, never primary, and confirmed first. */
const ENDING = new Set(["reject", "withdraw", "discard"]);

export function LeaveDetail() {
  const { id = "" } = useParams();
  const { hr, user } = useHr();
  const navigate = useNavigate();
  const location = useLocation();
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [unknown, setUnknown] = useState<{ fromVersion: number } | null>(null);

  const data = useLoad<Bundle>(async () => {
    const [record, workflow, history] = await Promise.all([hrApi.get<LeaveRequest>("leaveRequest", id), hrApi.workflow("leaveRequest", id), hrApi.history("leaveRequest", id)]);
    return { record, workflow, history };
  }, [id]);
  useEffect(() => { if (flash) window.history.replaceState({}, ""); }, [flash]);

  if (data.loading && !data.data) return <Spinner />;
  if (data.error) {
    const missing = data.error instanceof ApiError && (data.error.status === 404 || data.error.status === 400);
    return missing
      ? <EmptyState title={vi.leave.notFoundTitle} hint={vi.leave.notFoundBody} action={<Link className="btn" to="/hr">{vi.common.back}</Link>} />
      : <Alert tone="error" actions={<Button onClick={data.reload}>{vi.common.retry}</Button>}>{messageFor(data.error)}</Alert>;
  }
  const { record, workflow, history } = data.data!;
  const ops = hr.leave.allowedOperations;
  const canEdit = workflow.editable && Boolean(ops.update);
  const canDelete = workflow.editable && Boolean(ops.delete);
  const own = record.createdBy === user.id;
  const actions = workflow.allowedActions;
  const selfApprovalBlocked = own && record.state === "PENDING" && hr.has("manager") && !actions.some((item) => item.id === "approve");

  async function runTransition(action: string) {
    setBusy(action);
    setFailure(null);
    setFlash(null);
    try {
      await hrApi.transition("leaveRequest", id, action, record.version);
      setUnknown(null);
      setFlash(vi.leave.transitioned(leaveTransitionLabel(hr, action)));
      data.reload();
    } catch (error) {
      if (isUnknownOutcome(error)) setUnknown({ fromVersion: record.version });
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
      const fresh = await hrApi.get<LeaveRequest>("leaveRequest", id);
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
      await hrApi.remove("leaveRequest", id, record.version);
      navigate(ops.create ? "/hr/my-requests" : "/hr/requests", { state: { flash: vi.leave.deleted } });
    } catch (error) {
      setConfirm(null);
      setFailure(error);
    } finally {
      setBusy(null);
    }
  }

  const onAction = (action: string) => (ENDING.has(action) ? setConfirm({ kind: "transition", action }) : void runTransition(action));
  const conflict = isConflict(failure);
  const dialog = confirm?.kind === "transition"
    ? { title: leaveTransitionLabel(hr, confirm.action), message: vi.leave.confirm[confirm.action] ?? "", label: leaveTransitionLabel(hr, confirm.action), busy: busy === confirm.action, run: () => void runTransition(confirm.action) }
    : { title: vi.common.delete, message: vi.leave.deleteConfirm, label: vi.common.delete, busy: busy === "delete", run: () => void remove() };

  return (
    <>
      <PageHeader
        title={`${vi.leave.kinds[record.data.kind] ?? record.data.kind} · ${vi.leave.daysUnit(record.data.days)}`}
        subtitle={`${vi.leave.singular} ${shortId(record.id)}`}
        actions={canEdit ? <Link className="btn" to={`/hr/requests/${record.id}/edit`}><Pencil size={16} aria-hidden="true" />{vi.common.edit}</Link> : undefined}
      />
      {flash && <Alert tone="success" onClose={() => setFlash(null)}>{flash}</Alert>}
      {failure != null && (
        <Alert
          tone={isUnknownOutcome(failure) ? "warning" : "error"}
          title={isUnknownOutcome(failure) ? vi.errors.unknownTitle : undefined}
          actions={
            isUnknownOutcome(failure)
              ? <Button busy={busy === "check"} onClick={() => void check()}>{vi.errors.unknownCheck}</Button>
              : conflict ? <Button onClick={() => { setFailure(null); data.reload(); }}>{vi.common.reload}</Button> : undefined
          }
          onClose={isUnknownOutcome(failure) ? undefined : () => setFailure(null)}
        >
          {messageFor(failure)}
        </Alert>
      )}
      <StatusBanner state={record.state} label={leaveStateLabel(hr, record.state)} hint={vi.leave.stateHint[record.state ?? ""]} />

      <div className="detail-grid">
        <section className="card area-info" aria-labelledby="info-h">
          <h2 id="info-h" className="sr-only">{vi.leave.singular}</h2>
          <dl className="props">
            <div><dt>{vi.leave.kind}</dt><dd>{vi.leave.kinds[record.data.kind] ?? record.data.kind}</dd></div>
            <div><dt>{vi.leave.startDate}</dt><dd>{formatDate(record.data.startDate)}</dd></div>
            <div><dt>{vi.leave.days}</dt><dd>{record.data.days}</dd></div>
            <div><dt>{vi.leave.owner}</dt><dd title={own ? undefined : `…${record.createdBy.slice(-6)}`}>{own ? vi.leave.you : vi.leave.otherEmployee}</dd></div>
            <div><dt>{vi.common.created}</dt><dd>{formatDateTime(record.createdAt)}</dd></div>
            <div><dt>{vi.common.updated}</dt><dd>{formatDateTime(record.updatedAt)}</dd></div>
          </dl>
          <h3>{vi.leave.reason}</h3>
          <p className="prose" data-testid="leave-reason">{record.data.reason}</p>
          <TechInfo id={record.id} version={record.version} idLabel={vi.common.fullId} versionLabel={vi.leave.version} />
        </section>

        <ActionPanel
          actions={actions} ending={ENDING} labelOf={(action) => leaveTransitionLabel(hr, action)} busy={busy} locked={unknown !== null}
          emptyText={workflow.terminal ? vi.leave.locked : vi.leave.noActions} onAction={onAction}
          onDelete={canDelete ? () => setConfirm({ kind: "delete" }) : undefined}
        >
          {selfApprovalBlocked && <p className="muted small action-note" data-testid="self-approval-note">{vi.leave.selfApproval}</p>}
          {!workflow.editable && !workflow.terminal && Boolean(ops.update || ops.delete) && <p className="muted small action-note">{vi.leave.locked}</p>}
        </ActionPanel>

        <section className="card area-history" aria-labelledby="history-h">
          <h2 id="history-h">{vi.leave.history}</h2>
          {history.length === 0 ? (
            <p className="muted">{vi.leave.historyEmpty}</p>
          ) : (
            <HistoryTimeline
              history={history} createdBy={record.createdBy} stateName={(state) => leaveStateLabel(hr, state)}
              transitionName={(action) => leaveTransitionLabel(hr, action)}
              labels={{ createdBy: vi.leave.owner, handledBy: vi.leave.handledBy, machine: vi.ticket.machine }}
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
