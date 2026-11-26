// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Category, PlatformRecord } from "../api/types";
import { useReady } from "../auth/AuthContext";
import { Alert, Button, ConfirmDialog, EmptyState, Field, PageHeader, Pagination, Spinner, TableWrap } from "../components/ui";
import { fieldErrors, isConflict, isUnknownOutcome, messageFor } from "../domain/errors";
import { validateCategory } from "../domain/tickets";
import { useLoad } from "../hooks/useLoad";
import { vi } from "../i18n/vi";

const LIMIT = 20;
type Editing = { mode: "create" } | { mode: "edit"; record: PlatformRecord<Category> };

export function Categories() {
  const { caps, reloadCategories } = useReady();
  const ops = caps.category.allowedOperations;
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [removing, setRemoving] = useState<PlatformRecord<Category> | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useLoad(() => api.list<Category>("category", { limit: LIMIT, offset }), [offset]);

  async function refresh(message?: string) {
    if (message) setFlash(message);
    setFailure(null);
    list.reload();
    await reloadCategories().catch(() => undefined);
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.remove("category", removing.id, removing.version);
      setRemoving(null);
      await refresh(vi.category.deleted);
    } catch (error) {
      setRemoving(null);
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={vi.category.title}
        subtitle={ops.create ? vi.category.subtitleManage : vi.category.subtitleView}
        actions={ops.create ? <Button variant="primary" onClick={() => { setFlash(null); setEditing({ mode: "create" }); }}><Plus size={16} aria-hidden="true" />{vi.category.add}</Button> : undefined}
      />
      {flash && <Alert tone="success" onClose={() => setFlash(null)}>{flash}</Alert>}
      {failure != null && (
        <Alert
          tone={isUnknownOutcome(failure) ? "warning" : "error"} title={isUnknownOutcome(failure) ? vi.errors.unknownTitle : undefined}
          actions={isConflict(failure) || isUnknownOutcome(failure)
            ? <Button onClick={() => void refresh()}>{isUnknownOutcome(failure) ? vi.errors.unknownCheck : vi.common.reload}</Button> : undefined}
          onClose={() => setFailure(null)}
        >
          {messageFor(failure)}
        </Alert>
      )}
      {editing && (
        <CategoryForm
          key={editing.mode === "edit" ? editing.record.id : "new"} editing={editing}
          onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(vi.category.saved); }}
        />
      )}
      {list.error ? (
        <Alert tone="error" actions={<Button onClick={list.reload}>{vi.common.retry}</Button>}>{messageFor(list.error)}</Alert>
      ) : list.loading && !list.data ? (
        <Spinner />
      ) : list.data && list.data.items.length === 0 ? (
        <EmptyState title={vi.category.empty} />
      ) : (
        list.data && (
          <>
            <TableWrap label={vi.category.title}>
              <table className="table responsive">
                <caption className="sr-only">{vi.category.title}</caption>
                <thead>
                  <tr>
                    <th scope="col">{vi.category.code}</th><th scope="col">{vi.category.name}</th><th scope="col">{vi.category.description}</th>
                    <th scope="col">{vi.category.status}</th>{(ops.update || ops.delete) && <th scope="col">{vi.common.actions}</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((item) => (
                    <tr key={item.id}>
                      <td data-label={vi.category.code}><code>{item.data.code}</code></td>
                      <td data-label={vi.category.name}>{item.data.name}</td>
                      <td data-label={vi.category.description} className="muted">{item.data.description ?? vi.common.none}</td>
                      <td data-label={vi.category.status}>
                        <span className={`badge ${item.data.active ? "badge-success" : "badge-muted"}`}>{item.data.active ? vi.category.active : vi.category.inactive}</span>
                      </td>
                      {(ops.update || ops.delete) && (
                        <td data-label={vi.common.actions} className="row-actions">
                          {ops.update && <Button aria-label={`${vi.common.edit} ${item.data.code}`} onClick={() => { setFlash(null); setEditing({ mode: "edit", record: item }); }}><Pencil size={15} aria-hidden="true" />{vi.common.edit}</Button>}
                          {ops.delete && <Button variant="danger" aria-label={`${vi.common.delete} ${item.data.code}`} onClick={() => setRemoving(item)}><Trash2 size={15} aria-hidden="true" />{vi.common.delete}</Button>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pagination offset={offset} limit={LIMIT} total={list.data.total} onChange={setOffset} />
            <p className="muted small">{vi.category.note}</p>
          </>
        )
      )}
      <ConfirmDialog
        open={removing !== null} title={vi.common.delete} message={removing ? vi.category.deleteConfirm(removing.data.code) : ""}
        confirmLabel={vi.common.delete} busy={busy} onConfirm={() => void confirmRemove()} onCancel={() => setRemoving(null)}
      />
    </>
  );
}

function CategoryForm({ editing, onCancel, onSaved }: { editing: Editing; onCancel: () => void; onSaved: () => Promise<void> }) {
  const record = editing.mode === "edit" ? editing.record : null;
  const [values, setValues] = useState<Partial<Category>>(record?.data ?? { code: "", name: "", description: "", active: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const createId = useRef(crypto.randomUUID());
  const set = <K extends keyof Category>(key: K, value: Category[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: "" }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const data: Category = {
      code: values.code ?? "", name: (values.name ?? "").trim(), active: Boolean(values.active),
      ...(values.description?.trim() ? { description: values.description.trim() } : {}),
    };
    const problems = validateCategory(data);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    setFailure(null);
    try {
      if (record) await api.update("category", record.id, record.version, data);
      else await api.create("category", createId.current, data);
      await onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.code === "VALIDATION_FAILED") setErrors(fieldErrors(error));
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={(event) => void submit(event)} noValidate aria-label={record ? vi.category.editTitle : vi.category.createTitle}>
      <h2>{record ? vi.category.editTitle : vi.category.createTitle}</h2>
      {failure != null && (
        <Alert tone={isUnknownOutcome(failure) ? "warning" : "error"}>{messageFor(failure)}</Alert>
      )}
      <fieldset disabled={busy}>
        <div className="form-row">
          <Field label={vi.category.code} error={errors.code}>
            {(props) => <input {...props} type="text" maxLength={32} value={values.code ?? ""} disabled={Boolean(record)} onChange={(event) => set("code", event.target.value.toUpperCase())} />}
          </Field>
          <Field label={vi.category.name} error={errors.name}>
            {(props) => <input {...props} type="text" maxLength={200} value={values.name ?? ""} onChange={(event) => set("name", event.target.value)} />}
          </Field>
        </div>
        <Field label={vi.category.description} error={errors.description}>
          {(props) => <textarea {...props} rows={3} maxLength={2000} value={values.description ?? ""} onChange={(event) => set("description", event.target.value)} />}
        </Field>
        <label className="check">
          <input type="checkbox" checked={Boolean(values.active)} onChange={(event) => set("active", event.target.checked)} />
          <span>{vi.category.active}</span>
        </label>
      </fieldset>
      <div className="form-actions">
        <Button onClick={onCancel}>{vi.common.cancel}</Button>
        <Button type="submit" variant="primary" busy={busy}>{vi.common.save}</Button>
      </div>
    </form>
  );
}
