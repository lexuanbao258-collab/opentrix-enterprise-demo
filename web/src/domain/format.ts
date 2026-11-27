// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import type { Localized } from "../api/types";

const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date);
}

/** Vietnamese label first, then English, then the raw id. */
export function label(names: Localized | undefined, fallback: string): string {
  return names?.vi ?? names?.en ?? fallback;
}

/** Short, stable display code for a record id. */
export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

/** "2026-12-01" -> "01/12/2026" without time-zone conversion (the value is a calendar date, not an instant). */
export function formatDate(isoDate: string): string {
  const match = /^(d{4})-(d{2})-(d{2})$/.exec(isoDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
}
