// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { AlertCircle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { vi } from "../i18n/vi";

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary", busy = false, children, className = "", disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <Loader2 className="spin" size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Spinner({ label = vi.common.loading }: { label?: string }) {
  return (
    <div className="state-box" role="status">
      <Loader2 className="spin" size={22} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Alert({
  tone = "info", title, children, actions, onClose,
}: { tone?: "info" | "success" | "error" | "warning"; title?: string; children?: ReactNode; actions?: ReactNode; onClose?: () => void }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertCircle;
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" || tone === "warning" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" className="alert-icon" />
      <div className="alert-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
        {actions && <div className="alert-actions">{actions}</div>}
      </div>
      {onClose && (
        <button type="button" className="icon-btn" aria-label={vi.common.close} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="state-box empty">
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

const STATE_TONE: Record<string, string> = {
  DRAFT: "neutral", SUBMITTED: "info", IN_PROGRESS: "warning", RESOLVED: "accent", CLOSED: "success", CANCELLED: "muted",
};
export function StatusBadge({ state, label }: { state: string | null; label: string }) {
  return <span className={`badge badge-${STATE_TONE[state ?? ""] ?? "neutral"}`} data-state={state ?? ""}>{label}</span>;
}

const PRIORITY_TONE: Record<string, string> = { LOW: "muted", NORMAL: "neutral", HIGH: "warning", URGENT: "danger" };
export function PriorityBadge({ priority, label }: { priority: string; label: string }) {
  return <span className={`badge badge-${PRIORITY_TONE[priority] ?? "neutral"}`}>{label}</span>;
}

/** Horizontally scrollable region that keyboard users can focus (WCAG 2.1.1). */
export function TableWrap({ label, busy, children }: { label: string; busy?: boolean; children: ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} aria-busy={busy} tabIndex={0}>
      {children}
    </div>
  );
}

export function Pagination({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit) return total ? <p className="muted pager-note">{vi.common.page(1, total, total)}</p> : null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav className="pager" aria-label="Phân trang">
      <span className="muted" aria-live="polite">{vi.common.page(from, to, total)}</span>
      <div className="pager-buttons">
        <Button disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>{vi.common.prev}</Button>
        <Button disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>{vi.common.next}</Button>
      </div>
    </nav>
  );
}

export function Field({
  label, error, hint, children,
}: { label: string; error?: string; hint?: string; children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-err`}>{error}</p>}
    </div>
  );
}

/** Modal confirmation on the native <dialog> element: focus trap, Escape and backdrop come from the browser. */
export function ConfirmDialog({
  open, title, message, confirmLabel, busy, onConfirm, onCancel,
}: { open: boolean; title: string; message: string; confirmLabel: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onCancel={(event) => { event.preventDefault(); onCancel(); }} aria-labelledby="dialog-title">
      <h2 id="dialog-title">{title}</h2>
      <p>{message}</p>
      <div className="dialog-actions">
        <Button onClick={onCancel}>{vi.common.cancel}</Button>
        <Button variant="danger" busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
