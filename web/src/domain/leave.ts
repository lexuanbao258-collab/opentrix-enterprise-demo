// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import type { LeaveCapabilities } from "../auth/AuthContext";
import { vi } from "../i18n/vi";
import { label } from "./format";

export const LEAVE_KINDS = ["ANNUAL", "SICK", "UNPAID"] as const;
/** Limits of manifest `hr-leave` 1.1.0 (leaveRequest schema). The Platform stays the authority. */
export const LEAVE_LIMITS = { reason: 500, minDays: 1, maxDays: 30 } as const;

export function leaveStateLabel(caps: LeaveCapabilities, state: string | null): string {
  if (!state) return vi.common.none;
  const declared = caps.leave.workflow?.states.find((item) => item.id === state);
  return declared ? label(declared.name, state) : (vi.state[state] ?? state);
}

/** The manifest declares no transition names, so Vietnamese labels live in the UI. */
export function leaveTransitionLabel(caps: LeaveCapabilities, id: string): string {
  const declared = caps.leave.workflow?.transitions.find((item) => item.id === id);
  return vi.leave.transitions[id] ?? (declared ? label(declared.name, id) : id);
}

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};

/** Client-side validation that mirrors the manifest. No rule beyond the manifest is invented (no date ordering, no balance). */
export function validateLeave(data: { kind?: string; startDate?: string; days?: number | string; reason?: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!data.kind || !(LEAVE_KINDS as readonly string[]).includes(data.kind)) errors.kind = vi.form.required;
  if (!data.startDate || !validDate(data.startDate)) errors.startDate = !data.startDate ? vi.form.required : vi.form.invalidDate;
  const days = typeof data.days === "string" ? (data.days.trim() === "" ? NaN : Number(data.days)) : data.days;
  if (days === undefined || Number.isNaN(days)) errors.days = vi.form.required;
  else if (!Number.isInteger(days) || days < LEAVE_LIMITS.minDays || days > LEAVE_LIMITS.maxDays) errors.days = vi.form.daysRange;
  if (!data.reason?.trim()) errors.reason = vi.form.required;
  else if (data.reason.length > LEAVE_LIMITS.reason) errors.reason = vi.form.maxLength(LEAVE_LIMITS.reason);
  return errors;
}
