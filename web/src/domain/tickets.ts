// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import type { Capabilities } from "../auth/AuthContext";
import type { Category, PlatformRecord, Ticket } from "../api/types";
import { vi } from "../i18n/vi";
import { label } from "./format";

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const TICKET_LIMITS = { title: 200, description: 4000 } as const;

export function stateLabel(caps: Capabilities, state: string | null): string {
  if (!state) return vi.common.none;
  const declared = caps.ticket.workflow?.states.find((item) => item.id === state);
  return declared ? label(declared.name, state) : (vi.state[state] ?? state);
}

export function transitionLabel(caps: Capabilities, id: string): string {
  const declared = caps.ticket.workflow?.transitions.find((item) => item.id === id);
  return declared ? label(declared.name, id) : id;
}

export function categoryName(categories: PlatformRecord<Category>[], code: string): string | null {
  return categories.find((item) => item.data.code === code)?.data.name ?? null;
}

export interface Counts {
  byState: Record<string, number>;
  counted: number;
}

export function countByState(items: PlatformRecord<Ticket>[]): Counts {
  const byState: Record<string, number> = {};
  for (const item of items) byState[item.state ?? "?"] = (byState[item.state ?? "?"] ?? 0) + 1;
  return { byState, counted: items.length };
}

/** Client-side validation that mirrors the manifest. The backend remains the authority. */
export function validateTicket(data: Partial<Ticket>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!data.title?.trim()) errors.title = vi.form.required;
  else if (data.title.length > TICKET_LIMITS.title) errors.title = vi.form.maxLength(TICKET_LIMITS.title);
  if (!data.description?.trim()) errors.description = vi.form.required;
  else if (data.description.length > TICKET_LIMITS.description) errors.description = vi.form.maxLength(TICKET_LIMITS.description);
  if (!data.categoryCode) errors.categoryCode = vi.form.required;
  if (!data.priority) errors.priority = vi.form.required;
  return errors;
}

export function validateCategory(data: Partial<Category>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!data.code || !/^[A-Z][A-Z0-9_]{1,31}$/.test(data.code)) errors.code = vi.form.pattern;
  if (!data.name?.trim()) errors.name = vi.form.required;
  else if (data.name.length > 200) errors.name = vi.form.maxLength(200);
  if ((data.description?.length ?? 0) > 2000) errors.description = vi.form.maxLength(2000);
  return errors;
}
