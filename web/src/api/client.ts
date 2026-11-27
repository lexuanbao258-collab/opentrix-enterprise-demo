// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import type {
  AppInfo, AuditPage, EntityInfo, HistoryItem, Page, PlatformRecord, WorkflowInfo,
} from "./types";

/** Platform applications that ESM modules use. The BFF allowlists exactly these (bff/src/routes.ts). */
export const IT_APP = "it-helpdesk";
export const HR_APP = "hr-leave";
const BASE = "/bff/api/v1/apps";

export type ProblemCode =
  | "SESSION_EXPIRED" | "VALIDATION_FAILED" | "FORBIDDEN" | "NOT_FOUND" | "VERSION_CONFLICT" | "STATE_LOCKED"
  | "TRANSITION_NOT_ALLOWED" | "CREATE_ID_CONFLICT" | "COMMIT_OUTCOME_UNKNOWN" | "NETWORK" | "UNKNOWN" | string;

/** Failure of an API call. `errors` is keyed by JSON pointer (for example "/title"). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    message: string,
    readonly errors: Record<string, string> = {},
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
let onSessionExpired: () => void = () => {};

export function configureClient(options: { csrf: string | null; onSessionExpired?: () => void }) {
  csrfToken = options.csrf;
  if (options.onSessionExpired) onSessionExpired = options.onSessionExpired;
}

async function send<T>(method: string, path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
  const write = method !== "GET";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== "") search.set(key, String(value));
  const url = `${BASE}${path}${search.size ? `?${search}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(write && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // A write may have reached the server before the connection failed: never claim failure, never auto-retry.
    throw write
      ? new ApiError(0, "COMMIT_OUTCOME_UNKNOWN", "Không xác nhận được kết quả ghi dữ liệu")
      : new ApiError(0, "NETWORK", "Không thể kết nối tới máy chủ");
  }
  if (write && response.status === 500) {
    throw new ApiError(500, "COMMIT_OUTCOME_UNKNOWN", "Không xác nhận được kết quả ghi dữ liệu");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (response.ok) return payload as T;
  const problem = (payload ?? {}) as { code?: string; message?: string; errors?: Record<string, string> };
  const error = new ApiError(response.status, problem.code ?? "UNKNOWN", problem.message ?? `HTTP ${response.status}`, problem.errors ?? {});
  if (response.status === 401) onSessionExpired();
  throw error;
}

/** One client per Platform application: the same transport, CSRF handling and error mapping for every ESM module. */
export function createApi(appId: string) {
  const root = `/${appId}`;
  return {
    app: () => send<AppInfo>("GET", root),
    entity: (entity: string) => send<EntityInfo>("GET", `${root}/entities/${entity}`),

    list: <T>(entity: string, params: { q?: string; limit?: number; offset?: number } = {}) =>
      send<Page<T>>("GET", `${root}/entities/${entity}/records`, undefined, params),
    get: <T>(entity: string, id: string) => send<PlatformRecord<T>>("GET", `${root}/entities/${entity}/records/${id}`),

    /** `id` is generated once by the caller so that an explicit retry of an unknown create is idempotent. */
    create: <T>(entity: string, id: string, data: T) =>
      send<PlatformRecord<T>>("POST", `${root}/entities/${entity}/records`, { id, data }),
    update: <T>(entity: string, id: string, expectedVersion: number, data: T) =>
      send<PlatformRecord<T>>("PUT", `${root}/entities/${entity}/records/${id}`, { expectedVersion, data }),
    remove: (entity: string, id: string, expectedVersion: number) =>
      send<void>("DELETE", `${root}/entities/${entity}/records/${id}`, undefined, { expectedVersion }),

    workflow: (entity: string, id: string) => send<WorkflowInfo>("GET", `${root}/entities/${entity}/records/${id}/workflow`),
    history: (entity: string, id: string) => send<HistoryItem[]>("GET", `${root}/entities/${entity}/records/${id}/history`),
    transition: <T>(entity: string, id: string, transition: string, expectedVersion: number) =>
      send<PlatformRecord<T>>("POST", `${root}/entities/${entity}/records/${id}/transitions/${transition}`, { expectedVersion }),

    audit: (entity: string, params: { recordId?: string; limit?: number; offset?: number } = {}) =>
      send<AuditPage>("GET", `${root}/entities/${entity}/audit`, undefined, params),
  };
}
export type AppApi = ReturnType<typeof createApi>;

export const api = createApi(IT_APP);
export const hrApi = createApi(HR_APP);

/** Application discovery: the applications in which the caller holds a role. */
export const discoverApps = () => send<AppInfo[]>("GET", "");

export interface Collected<T> {
  items: PlatformRecord<T>[];
  total: number;
  /** True when more records exist than were loaded (the cap was reached). */
  truncated: boolean;
}

/**
 * The API has no aggregate endpoint. This reads authorized pages (100 per call) up to `cap` records,
 * so callers can show exact numbers when `truncated` is false and must label the scope when it is true.
 */
export async function collect<T>(entity: string, options: { q?: string; cap?: number; client?: AppApi } = {}): Promise<Collected<T>> {
  const client = options.client ?? api;
  const cap = options.cap ?? 500;
  const first = await client.list<T>(entity, { q: options.q, limit: 100, offset: 0 });
  const wanted = Math.min(first.total, cap);
  const offsets: number[] = [];
  for (let offset = 100; offset < wanted; offset += 100) offsets.push(offset);
  const rest = await Promise.all(offsets.map((offset) => client.list<T>(entity, { q: options.q, limit: 100, offset })));
  const items = [first, ...rest].flatMap((page) => page.items).slice(0, cap);
  return { items, total: first.total, truncated: first.total > items.length };
}
