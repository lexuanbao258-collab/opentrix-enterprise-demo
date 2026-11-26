// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { ApiError } from "../api/client";
import { vi } from "../i18n/vi";

/** User-facing message for a failed call. Server messages are not shown verbatim: they are English and technical. */
export function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return vi.errors.generic;
  switch (error.code) {
    case "NETWORK": return vi.errors.network;
    case "FORBIDDEN": return vi.errors.forbidden;
    case "NOT_FOUND": return vi.errors.notFound;
    case "VERSION_CONFLICT": return vi.errors.versionConflict;
    case "STATE_LOCKED": return vi.errors.stateLocked;
    case "TRANSITION_NOT_ALLOWED": return vi.errors.transitionNotAllowed;
    case "VALIDATION_FAILED": return vi.errors.validation;
    case "COMMIT_OUTCOME_UNKNOWN": return vi.errors.unknown;
    case "SESSION_EXPIRED": return vi.auth.expiredTitle;
    default: return error.status >= 500 ? vi.errors.unavailable : vi.errors.generic;
  }
}

export const isUnknownOutcome = (error: unknown) => error instanceof ApiError && error.code === "COMMIT_OUTCOME_UNKNOWN";
export const isConflict = (error: unknown) =>
  error instanceof ApiError && (error.code === "VERSION_CONFLICT" || error.code === "TRANSITION_NOT_ALLOWED" || error.code === "STATE_LOCKED");

/** "/title" -> "title" so errors can be attached to form fields. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(Object.entries(error.errors).map(([pointer, text]) => [pointer.replace(/^\//, ""), text]));
}
