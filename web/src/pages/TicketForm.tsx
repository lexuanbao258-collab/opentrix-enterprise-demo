// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { PlatformRecord, Ticket } from "../api/types";
import { useReady } from "../auth/AuthContext";
import { Alert, Button, EmptyState, Field, PageHeader, Spinner } from "../components/ui";
import { fieldErrors, isUnknownOutcome, messageFor } from "../domain/errors";
import { PRIORITIES, TICKET_LIMITS, validateTicket } from "../domain/tickets";
import { useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

type Intent = "draft" | "submit";
interface Unknown { intent: Intent; kind: "create" | "update"; payload: Ticket; message?: string; retryable: boolean }

const EMPTY: Partial<Ticket> = { title: "", description: "", categoryCode: "", priority: "NORMAL" };

export function TicketForm({ mode }: { mode: "new" | "edit" }) {
  const { id: editId } = useParams();
  const existing = useLoad(
    async () => {
      if (mode !== "edit" || !editId) return null;
      const [record, workflow] = await Promise.all([api.get<Ticket>("ticket", editId), api.workflow("ticket", editId)]);
      return { record, workflow };
    },
    [mode, editId],
  );
  if (mode === "edit") {
    if (existing.loading && !existing.data) return <Spinner />;
    if (existing.error) {
      const missing = existing.error instanceof ApiError && existing.error.status === 404;
      return missing
        ? <EmptyState title={vi.ticket.notFoundTitle} hint={vi.ticket.notFoundBody} action={<Link className="btn" to="/">{vi.common.back}</Link>} />
        : <Alert tone="error" actions={<Button onClick={existing.reload}>{vi.common.retry}</Button>}>{messageFor(existing.error)}</Alert>;
    }
    if (existing.data && !existing.data.workflow.editable) {
      return (
        <Alert tone="warning" title={vi.ticket.locked} actions={<Link className="btn" to={`/tickets/${editId}`}>{vi.common.back}</Link>} />
      );
    }
  }
  return <FormBody mode={mode} record={existing.data?.record ?? null} />;
}

function FormBody({ mode, record }: { mode: "new" | "edit"; record: PlatformRecord<Ticket> | null }) {
  const { categories } = useReady();
  const navigate = useNavigate();
  const [values, setValues] = useState<Partial<Ticket>>(record?.data ?? EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState<Intent | null>(null);
  const [unknown, setUnknown] = useState<Unknown | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Stable per form instance: an explicit retry of an unknown create reuses the id, so the Platform can deduplicate it.
  const createId = useRef<string>(crypto.randomUUID());
  const version = useRef<number>(record?.version ?? 0);

  const active = categories.filter((item) => item.data.active);
  const options = [...active];
  const current = values.categoryCode;
  const hasCurrent = !current || options.some((item) => item.data.code === current);

  const set = <K extends keyof Ticket>(key: K, value: Ticket[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: "" }));
  };

  const finish = (id: string, flash: string) => navigate(`/tickets/${id}`, { state: { flash } });

  async function run(intent: Intent, payload: Ticket) {
    setBusy(intent);
    setFailure(null);
    setNotice(null);
    let savedId = mode === "edit" ? (record as PlatformRecord<Ticket>).id : createId.current;
    try {
      const saved = mode === "new"
        ? await api.create("ticket", createId.current, payload)
        : await api.update("ticket", savedId, version.current, payload);
      savedId = saved.id;
      version.current = saved.version;
    } catch (error) {
      setBusy(null);
      if (isUnknownOutcome(error)) return setUnknown({ intent, kind: mode === "new" ? "create" : "update", payload, retryable: false });
      if (error instanceof ApiError && error.code === "VALIDATION_FAILED") setErrors(fieldErrors(error));
      return setFailure(error);
    }
    if (intent === "draft") return finish(savedId, mode === "new" ? vi.ticket.created : vi.ticket.updated);
    try {
      await api.transition("ticket", savedId, "submit", version.current);
      finish(savedId, vi.ticket.submitted);
    } catch {
      // The draft is saved; the detail page shows the real state and offers the submit action.
      finish(savedId, `${vi.ticket.created} ${vi.errors.generic}`);
    }
  }

  function onSubmit(event: FormEvent, intent: Intent) {
    event.preventDefault();
    const payload: Partial<Ticket> = {
      title: values.title?.trim(), description: values.description?.trim(), categoryCode: values.categoryCode, priority: values.priority,
    };
    const problems = validateTicket(payload);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    void run(intent, payload as Ticket);
  }

  /** Reconcile an unknown outcome by reading; never by repeating the write. */
  async function check() {
    if (!unknown) return;
    setBusy(unknown.intent);
    try {
      if (unknown.kind === "create") {
        try {
          await api.get<Ticket>("ticket", createId.current);
          setNotice(vi.errors.unknownResolvedCreated);
          setUnknown(null);
          if (unknown.intent === "draft") return finish(createId.current, vi.errors.unknownResolvedCreated);
          version.current = (await api.get<Ticket>("ticket", createId.current)).version;
          await api.transition("ticket", createId.current, "submit", version.current);
          return finish(createId.current, vi.ticket.submitted);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            setNotice(vi.errors.unknownResolvedMissing);
            return setUnknown({ ...unknown, retryable: true });
          }
          throw error;
        }
      }
      const fresh = await api.get<Ticket>("ticket", (record as PlatformRecord<Ticket>).id);
      if (fresh.version > version.current) {
        setNotice(vi.errors.unknownResolvedApplied);
        setUnknown(null);
        return finish(fresh.id, vi.ticket.updated);
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
  const title = mode === "new" ? vi.ticket.createTitle : vi.ticket.editTitle;

  return (
    <>
      <PageHeader title={title} />
      {failure != null && <Alert tone="error" title={vi.errors.generic} onClose={() => setFailure(null)}>{messageFor(failure)}</Alert>}
      {unknown && (
        <Alert
          tone="warning" title={vi.errors.unknownTitle}
          actions={
            <>
              <Button busy={busy !== null} onClick={() => void check()}>{vi.errors.unknownCheck}</Button>
              {unknown.retryable && (
                <Button variant="primary" busy={busy !== null} onClick={() => void run(unknown.intent, unknown.payload)}>
                  {vi.errors.unknownRetryCreate}
                </Button>
              )}
            </>
          }
        >
          {vi.errors.unknown}
        </Alert>
      )}
      {notice && !unknown && <Alert tone="info">{notice}</Alert>}
      {notice && unknown && <Alert tone="info">{notice}</Alert>}

      <form className="card form" noValidate onSubmit={(event) => onSubmit(event, "draft")} aria-label={title}>
        <fieldset disabled={locked || busy !== null}>
          <Field label={vi.ticket.title} error={errors.title}>
            {(props) => (
              <input {...props} type="text" required maxLength={TICKET_LIMITS.title} value={values.title ?? ""} onChange={(event) => set("title", event.target.value)} />
            )}
          </Field>
          <Field label={vi.ticket.category} error={errors.categoryCode} hint={active.length === 0 ? vi.form.noActiveCategory : undefined}>
            {(props) => (
              <select {...props} required value={values.categoryCode ?? ""} onChange={(event) => set("categoryCode", event.target.value)}>
                <option value="">{vi.form.chooseCategory}</option>
                {!hasCurrent && <option value={current}>{current} ({vi.ticket.categoryMissing})</option>}
                {options.map((item) => <option key={item.id} value={item.data.code}>{item.data.name}</option>)}
              </select>
            )}
          </Field>
          <Field label={vi.ticket.priority} error={errors.priority}>
            {(props) => (
              <select {...props} required value={values.priority ?? ""} onChange={(event) => set("priority", event.target.value as Ticket["priority"])}>
                {PRIORITIES.map((item) => <option key={item} value={item}>{vi.priority[item]}</option>)}
              </select>
            )}
          </Field>
          <Field label={vi.ticket.description} error={errors.description} hint={vi.form.maxLength(TICKET_LIMITS.description)}>
            {(props) => (
              <textarea {...props} required rows={8} maxLength={TICKET_LIMITS.description} value={values.description ?? ""} onChange={(event) => set("description", event.target.value)} />
            )}
          </Field>
        </fieldset>
        <div className="form-actions">
          <Link className="btn" to={mode === "edit" && record ? `/tickets/${record.id}` : "/my-requests"}>{vi.common.cancel}</Link>
          <Button type="submit" busy={busy === "draft"} disabled={locked || busy !== null}>{vi.ticket.saveDraft}</Button>
          <Button variant="primary" busy={busy === "submit"} disabled={locked || busy !== null} onClick={(event) => onSubmit(event, "submit")}>
            {vi.ticket.submitNow}
          </Button>
        </div>
      </form>
    </>
  );
}
