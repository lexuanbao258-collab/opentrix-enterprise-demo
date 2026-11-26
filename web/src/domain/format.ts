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
