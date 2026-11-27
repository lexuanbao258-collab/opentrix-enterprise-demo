// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, hrApi } from "../api/client";
import type { LeaveRequest, PlatformRecord } from "../api/types";
import { Alert, Button, EmptyState, Field, PageHeader, Spinner, focusFirstInvalid } from "../components/ui";
import { fieldErrors, isUnknownOutcome, messageFor } from "../domain/errors";
import { LEAVE_KINDS, LEAVE_LIMITS, validateLeave } from "../domain/leave";
import { useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

type Intent = "draft" | "submit";
interface Unknown { intent: Intent; kind: "create" | "update"; payload: LeaveRequest; retryable: boolean }
interface Values { kind: string; startDate: string; days: string; reason: string }

const EMPTY: Values = { kind: "ANNUAL", startDate: "", days: "1", reason: "" };

export function LeaveForm({ mode }: { mode: "new" | "edit" }) {
  const { id: editId } = useParams();
  const existing = useLoad(
    async () => {
      if (mode !== "edit" || !editId) return null;
      const [record, workflow] = await Promise.all([hrApi.get<LeaveRequest>("leaveRequest", editId), hrApi.workflow("leaveRequest", editId)]);
      return { record, workflow };
    },
    [mode, editId],
  );
  if (mode === "edit") {
    if (existing.loading && !existing.data) return <Spinner />;
    if (existing.error) {
      const missing = existing.error instanceof ApiError && existing.error.status === 404;
      return missing
        ? <EmptyState title={vi.leave.notFoundTitle} hint={vi.leave.notFoundBody} action={<Link className="btn" to="/hr">{vi.common.back}</Link>} />
        : <Alert tone="error" actions={<Button onClick={existing.reload}>{vi.common.retry}</Button>}>{messageFor(existing.error)}</Alert>;
    }
    if (existing.data && !existing.data.workflow.editable) {
      return <Alert tone="warning" title={vi.leave.locked} actions={<Link className="btn" to={`/hr/requests/${editId}`}>{vi.common.back}</Link>} />;
    }
  }
  return <FormBody mode={mode} record={existing.data?.record ?? null} />;
}

function FormBody({ mode, record }: { mode: "new" | "edit"; record: PlatformRecord<LeaveRequest> | null }) {
  const navigate = useNavigate();
  const [values, setValues] = useState<Values>(record ? { ...record.data, days: String(record.data.days) } : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState<Intent | null>(null);
  const [unknown, setUnknown] = useState<Unknown | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Stable per form instance: an explicit retry of an unknown create reuses the id, so the Platform can deduplicate it.
  const createId = useRef<string>(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const version = useRef<number>(record?.version ?? 0);

  const set = (key: keyof Values, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: "" }));
  };

  const finish = (id: string, flash: string) => navigate(`/hr/requests/${id}`, { state: { flash } });

  async function run(intent: Intent, payload: LeaveRequest) {
    setBusy(intent);
    setFailure(null);
    setNotice(null);
    let savedId = mode === "edit" ? (record as PlatformRecord<LeaveRequest>).id : createId.current;
    try {
      const saved = mode === "new"
        ? await hrApi.create("leaveRequest", createId.current, payload)
        : await hrApi.update("leaveRequest", savedId, version.current, payload);
      savedId = saved.id;
      version.current = saved.version;
    } catch (error) {
      setBusy(null);
      if (isUnknownOutcome(error)) return setUnknown({ intent, kind: mode === "new" ? "create" : "update", payload, retryable: false });
      if (error instanceof ApiError && error.code === "VALIDATION_FAILED") setErrors(fieldErrors(error));
      return setFailure(error);
    }
    if (intent === "draft") return finish(savedId, mode === "new" ? vi.leave.created : vi.leave.updated);
    try {
      await hrApi.transition("leaveRequest", savedId, "submit", version.current);
      finish(savedId, vi.leave.submitted);
    } catch {
      // The draft is saved; the detail page shows the real state and offers the submit action.
      finish(savedId, `${vi.leave.created} ${vi.errors.generic}`);
    }
  }

  function onSubmit(event: FormEvent, intent: Intent) {
    event.preventDefault();
    const problems = validateLeave(values);
    setErrors(problems);
    if (Object.keys(problems).length) return focusFirstInvalid(formRef.current);
    void run(intent, { kind: values.kind as LeaveRequest["kind"], startDate: values.startDate, days: Number(values.days), reason: values.reason.trim() });
  }

  /** Reconcile an unknown outcome by reading; never by repeating the write. */
  async function check() {
    if (!unknown) return;
    setBusy(unknown.intent);
    try {
      if (unknown.kind === "create") {
        try {
          const fresh = await hrApi.get<LeaveRequest>("leaveRequest", createId.current);
          setNotice(vi.leave.unknownCreated);
          setUnknown(null);
          if (unknown.intent === "draft") return finish(createId.current, vi.leave.unknownCreated);
          await hrApi.transition("leaveRequest", createId.current, "submit", fresh.version);
          return finish(createId.current, vi.leave.submitted);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            setNotice(vi.leave.unknownMissing);
            return setUnknown({ ...unknown, retryable: true });
          }
          throw error;
        }
      }
      const fresh = await hrApi.get<LeaveRequest>("leaveRequest", (record as PlatformRecord<LeaveRequest>).id);
      if (fresh.version > version.current) {
        setNotice(vi.errors.unknownResolvedApplied);
        setUnknown(null);
        return finish(fresh.id, vi.leave.updated);
      }
      setNotice(vi.errors.unknownResolvedPending);
      setUnknown({ ...unknown, retryable: true });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  }

  const locked = unknown !== null;
  const title = mode === "new" ? vi.leave.createTitle : vi.leave.editTitle;

  return (
    <>
      <PageHeader title={title} subtitle={vi.leave.flowNote} />
      {failure != null && <Alert tone="error" title={vi.errors.generic} onClose={() => setFailure(null)}>{messageFor(failure)}</Alert>}
      {unknown && (
        <Alert
          tone="warning" title={vi.errors.unknownTitle}
          actions={
            <>
              <Button busy={busy !== null} onClick={() => void check()}>{vi.errors.unknownCheck}</Button>
              {unknown.retryable && (
                <Button variant="primary" busy={busy !== null} onClick={() => void run(unknown.intent, unknown.payload)}>{vi.errors.unknownRetryCreate}</Button>
              )}
            </>
          }
        >
          {vi.errors.unknown}
        </Alert>
      )}
      {notice && <Alert tone="info">{notice}</Alert>}

      <form ref={formRef} className="card form" noValidate onSubmit={(event) => onSubmit(event, "draft")} aria-label={title}>
        <fieldset disabled={locked || busy !== null}>
          <div className="form-section">
            <h2 className="form-section-title">{vi.leave.sectionPeriod}</h2>
            <Field label={vi.leave.kind} error={errors.kind}>
              {(props) => (
                <select {...props} required value={values.kind} onChange={(event) => set("kind", event.target.value)}>
                  <option value="">{vi.form.chooseKind}</option>
                  {LEAVE_KINDS.map((item) => <option key={item} value={item}>{vi.leave.kinds[item]}</option>)}
                </select>
              )}
            </Field>
            <div className="form-row">
              <Field label={vi.leave.startDate} error={errors.startDate}>
                {(props) => <input {...props} type="date" required value={values.startDate} onChange={(event) => set("startDate", event.target.value)} />}
              </Field>
              <Field label={vi.leave.days} error={errors.days} hint={vi.form.daysRange}>
                {(props) => (
                  <input {...props} type="number" required inputMode="numeric" min={LEAVE_LIMITS.minDays} max={LEAVE_LIMITS.maxDays} step={1} value={values.days} onChange={(event) => set("days", event.target.value)} />
                )}
              </Field>
            </div>
          </div>
          <div className="form-section">
            <h2 className="form-section-title">{vi.leave.sectionReason}</h2>
            <Field label={vi.leave.reason} error={errors.reason} hint={`${values.reason.length}/${LEAVE_LIMITS.reason} ${vi.form.chars}. ${vi.leave.reasonSensitive}`}>
              {(props) => (
                <textarea {...props} required rows={6} maxLength={LEAVE_LIMITS.reason} value={values.reason} onChange={(event) => set("reason", event.target.value)} />
              )}
            </Field>
          </div>
        </fieldset>
        <div className="form-actions">
          <Link className="btn" to={mode === "edit" && record ? `/hr/requests/${record.id}` : "/hr/my-requests"}>{vi.common.cancel}</Link>
          <Button type="submit" busy={busy === "draft"} disabled={locked || busy !== null}>{vi.leave.saveDraft}</Button>
          <Button variant="primary" busy={busy === "submit"} disabled={locked || busy !== null} onClick={(event) => onSubmit(event, "submit")}>{vi.leave.submitNow}</Button>
        </div>
      </form>
    </>
  );
}
