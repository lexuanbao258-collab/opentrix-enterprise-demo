// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { EntityInfo, PlatformRecord, Ticket, Category } from "../api/types";
import { AuthContext, type AuthApi, type AuthState } from "../auth/AuthContext";

export const TRANSITIONS = [
  ["submit", "DRAFT", "SUBMITTED", "Gửi yêu cầu"], ["discard", "DRAFT", "CANCELLED", "Hủy bản nháp"],
  ["cancel", "SUBMITTED", "CANCELLED", "Hủy yêu cầu"], ["start", "SUBMITTED", "IN_PROGRESS", "Tiếp nhận xử lý"],
  ["resolve", "IN_PROGRESS", "RESOLVED", "Đánh dấu đã xử lý"], ["confirm", "RESOLVED", "CLOSED", "Xác nhận đã xử lý"],
  ["reopen", "RESOLVED", "IN_PROGRESS", "Yêu cầu xử lý lại"],
] as const;

const STATES: [string, string][] = [
  ["DRAFT", "Nháp"], ["SUBMITTED", "Đã gửi"], ["IN_PROGRESS", "Đang xử lý"], ["RESOLVED", "Đã xử lý"], ["CLOSED", "Đã đóng"], ["CANCELLED", "Đã hủy"],
];

export function ticketEntity(ops: Record<string, "own" | "all">): EntityInfo {
  return {
    app: "it-helpdesk", key: "ticket", name: { vi: "Phiếu hỗ trợ" }, schema: {}, searchFields: ["title"], allowedOperations: ops,
    workflow: {
      initialState: "DRAFT",
      states: STATES.map(([id, vi]) => ({ id, name: { vi }, editable: id === "DRAFT", terminal: id === "CLOSED" || id === "CANCELLED" })),
      transitions: TRANSITIONS.map(([id, from, to, vi]) => ({ id, from, to, name: { vi }, allowedForCaller: true, notByCreator: false })),
    },
  };
}

export const category = (code: string, name: string, active = true): PlatformRecord<Category> => ({
  id: `00000000-0000-4000-8000-${code.padEnd(12, "0").slice(0, 12)}`, app: "it-helpdesk", entity: "category", version: 0, state: null,
  data: { code, name, active }, createdBy: "a", createdAt: "2026-11-27T00:00:00Z", updatedBy: "a", updatedAt: "2026-11-27T00:00:00Z",
});

export function ticket(overrides: Partial<PlatformRecord<Ticket>> = {}): PlatformRecord<Ticket> {
  return {
    id: "11111111-1111-4111-8111-111111111111", app: "it-helpdesk", entity: "ticket", version: 0, state: "DRAFT", createdBy: "u1",
    createdAt: "2026-11-27T01:00:00Z", updatedBy: "u1", updatedAt: "2026-11-27T01:00:00Z",
    data: { title: "VPN lỗi", description: "Không kết nối", categoryCode: "NETWORK", priority: "HIGH" }, ...overrides,
  };
}

export const REQUESTER_OPS = { read: "own", create: "own", update: "own", delete: "own" } as const;
export const AGENT_OPS = { read: "all" } as const;

export function readyState(ops: Record<string, "own" | "all">, roles: string[], expired = false): AuthState {
  return {
    status: "ready", user: { name: "Trần Minh Khoa", username: "u" }, csrf: "csrf", expired,
    categories: [category("NETWORK", "Mạng và VPN"), category("OLD", "Cũ", false)],
    caps: {
      app: { id: "it-helpdesk", version: "1.1.0", name: {}, description: {}, callerRoles: roles, entities: [] },
      ticket: ticketEntity(ops), category: { ...ticketEntity({ read: "all" }), key: "category", workflow: null }, roles, has: (role) => roles.includes(role),
    },
  };
}

export function renderAt(ui: ReactElement, options: { path?: string; route?: string; state?: AuthState } = {}) {
  const value: AuthApi = {
    state: options.state ?? readyState(REQUESTER_OPS, ["requester"]), signIn: () => undefined, signOut: async () => undefined,
    reloadCategories: async () => undefined,
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[options.path ?? "/"]}>
        <Routes><Route path={options.route ?? "*"} element={ui} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

export interface Call { method: string; url: string; body: unknown; headers: Record<string, string> }

/** Replaces fetch with a scripted fake. Each handler returns [status, body] or throws to simulate a network failure. */
export function mockFetch(handler: (call: Call) => [number, unknown] | undefined) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const result = handler(call);
    if (!result) throw new TypeError("network down");
    const [status, body] = result;
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}
