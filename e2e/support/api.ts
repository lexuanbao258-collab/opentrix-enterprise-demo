// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request, type APIRequestContext } from "@playwright/test";

export const BASE_URL = process.env.ESM_PUBLIC_ORIGIN ?? "http://localhost:5174";
export const IT = "it-helpdesk";
export const HR = "hr-leave";

/** IT Helpdesk roles (M3) and HR Leave roles (M4). `dual` holds it-helpdesk:requester + hr-leave:employee + hr-leave:manager. */
export type Role = "requester1" | "requester2" | "agent" | "admin" | "employee1" | "employee2" | "manager" | "auditor" | "dual";
const USERS: Record<Role, { username: string; env: string }> = {
  requester1: { username: "esm-requester1", env: "ESM_PASSWORD_REQUESTER1" },
  requester2: { username: "esm-requester2", env: "ESM_PASSWORD_REQUESTER2" },
  agent: { username: "esm-agent", env: "ESM_PASSWORD_AGENT" },
  admin: { username: "esm-admin", env: "ESM_PASSWORD_ADMIN" },
  employee1: { username: "esm-employee1", env: "ESM_PASSWORD_EMPLOYEE1" },
  employee2: { username: "esm-employee2", env: "ESM_PASSWORD_EMPLOYEE2" },
  manager: { username: "esm-manager", env: "ESM_PASSWORD_MANAGER" },
  auditor: { username: "esm-auditor", env: "ESM_PASSWORD_AUDITOR" },
  dual: { username: "esm-dual", env: "ESM_PASSWORD_DUAL" },
};

/** Passwords come from the environment or the git-ignored .local/esm.env. Never hardcoded. */
export function credentials(role: Role): { username: string; password: string } {
  const { username, env } = USERS[role];
  let password = process.env[env];
  if (!password) {
    const file = readFileSync(new URL("../../.local/esm.env", import.meta.url), "utf8");
    password = file.split(/\r?\n/).find((line) => line.startsWith(`${env}=`))?.slice(env.length + 1);
  }
  if (!password) throw new Error(`Missing ${env}`);
  return { username, password };
}

export interface Reply<T = any> {
  status: number;
  body: T;
}

export class Api {
  constructor(
    readonly context: APIRequestContext,
    readonly csrf: string,
    /** Platform application this client talks to (through the BFF allowlist). */
    readonly app: string = IT,
  ) {}

  /** The same signed-in user (same session and CSRF token), addressing another application. */
  forApp(app: string): Api {
    return new Api(this.context, this.csrf, app);
  }

  /** Raw path below /bff/api/v1/apps, for discovery and cross-app probes. */
  async raw<T = any>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
    const response = await this.context.fetch(`/bff/api/v1/apps${path}`, {
      method,
      headers: method === "GET" ? {} : { Origin: BASE_URL, "X-CSRF-Token": this.csrf },
      data: body,
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    const text = await response.text();
    return { status: response.status(), body: text ? JSON.parse(text) : null };
  }

  async call<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply<T>> {
    const response = await this.context.fetch(`/bff/api/v1/apps/${this.app}${path}`, {
      method,
      headers: method === "GET" ? headers : { Origin: BASE_URL, "X-CSRF-Token": this.csrf, ...headers },
      data: body === undefined ? undefined : body,
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    const text = await response.text();
    return { status: response.status(), body: text ? JSON.parse(text) : null };
  }
  get = <T = any>(path: string) => this.call<T>("GET", path);
  post = <T = any>(path: string, body: unknown) => this.call<T>("POST", path, body);
  put = <T = any>(path: string, body: unknown) => this.call<T>("PUT", path, body);
  del = <T = any>(path: string) => this.call<T>("DELETE", path);

  /** Create with a stable client-generated id (idempotent per the Platform contract). */
  create<T = any>(entity: string, data: unknown, id: string = randomUUID()) {
    return this.post<T>(`/entities/${entity}/records`, { id, data });
  }
  transition<T = any>(entity: string, id: string, transition: string, expectedVersion: number) {
    return this.post<T>(`/entities/${entity}/records/${id}/transitions/${transition}`, { expectedVersion });
  }
  dispose() {
    return this.context.dispose();
  }
}

/** Signs in through the real BFF and Keycloak login form (Authorization Code + PKCE). */
export async function apiLogin(role: Role): Promise<Api> {
  const { username, password } = credentials(role);
  // Explicitly empty: a project-level storageState must not leak an SSO session into this fresh login.
  const context = await request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const page = await context.get("/bff/login", { failOnStatusCode: false });
  const html = await page.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1] ?? /<form[^>]*action="([^"]+)"[^>]*id="kc-form-login"/.exec(html)?.[1];
  if (!action) throw new Error(`Keycloak login form not found (status ${page.status()}, ${page.url().split("?")[0]}, title: ${/<title>([^<]*)/.exec(html)?.[1]})`);
  const done = await context.post(action.replace(/&amp;/g, "&"), { form: { username, password }, failOnStatusCode: false });
  if (done.status() >= 400 && done.status() !== 404) throw new Error(`Login failed for ${role}: ${done.status()}`);
  const session = await (await context.get("/bff/session")).json();
  if (!session.authenticated) throw new Error(`Login did not create a session for ${role}`);
  return new Api(context, session.csrfToken);
}
