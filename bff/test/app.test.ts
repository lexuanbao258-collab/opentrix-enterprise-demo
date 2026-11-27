// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { platformActorId, type OidcPort, type TokenSet } from "../src/oidc.js";
import { matchRoute, cleanQuery } from "../src/routes.js";
import { SessionStore } from "../src/sessions.js";

const ORIGIN = "http://localhost:5174";
const UUID = "0b3f6d7e-1c2a-4f5b-9d8e-123456789abc";
const config: Config = {
  port: 0, host: "127.0.0.1", publicOrigin: ORIGIN, oidcIssuer: "http://kc.test/realms/r", oidcClientId: "esm-bff",
  oidcClientSecret: "s", platformApiUrl: "https://platform.test", cookieSecure: false,
  sessionIdleMs: 60_000, sessionMaxMs: 600_000, staticDir: null,
};

function tokens(expiresInMs = 300_000): TokenSet {
  return { accessToken: "AT-1", refreshToken: "RT-1", idToken: "IDT", expiresAt: Date.now() + expiresInMs };
}

function fakeOidc(overrides: Partial<OidcPort> = {}): OidcPort {
  return {
    startLogin: async () => ({ url: "http://kc.test/auth?x=1", codeVerifier: "v", state: "st", nonce: "n" }),
    finishLogin: async () => ({ tokens: tokens(), user: { sub: "u1", iss: "http://kc.test/realms/r", name: "Nguyen A", username: "a" } }),
    refresh: async () => ({ ...tokens(), accessToken: "AT-2" }),
    logoutUrl: async (idToken) => `http://kc.test/logout?id_token_hint=${idToken}`,
    ...overrides,
  };
}

interface Seen { url: string; method: string; headers: Record<string, string>; body?: string }

function harness(options: { oidc?: OidcPort; fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch =
    options.fetchImpl ??
    (async (input, init) => {
      seen.push({
        url: String(input), method: String(init?.method), headers: { ...(init?.headers as Record<string, string>) },
        body: init?.body ? Buffer.from(init.body as Uint8Array).toString() : undefined,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "leak=1" } });
    });
  const sessions = new SessionStore(config.sessionIdleMs, config.sessionMaxMs, options.now);
  const oidc = options.oidc ?? fakeOidc();
  const app = createApp({ config, oidc, sessions, fetchImpl });
  return { app, seen, sessions, agent: request.agent(app) };
}

async function login(agent: ReturnType<typeof request.agent>, returnTo = "/tickets") {
  await agent.get(`/bff/login?returnTo=${encodeURIComponent(returnTo)}`).expect(302);
  const res = await agent.get("/bff/callback?code=c&state=st").expect(302);
  const session = await agent.get("/bff/session").expect(200);
  return { res, csrf: session.body.csrfToken as string };
}

describe("login and session", () => {
  it("redirects to the identity provider and keeps PKCE material server-side", async () => {
    const { agent } = harness();
    const res = await agent.get("/bff/login").expect(302);
    expect(res.headers.location).toBe("http://kc.test/auth?x=1");
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("esm_login=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("verifier");
  });

  it("creates an HttpOnly SameSite session, returns only a CSRF token and no tokens", async () => {
    const { agent } = harness();
    const { res, csrf } = await login(agent);
    expect(res.headers.location).toBe("/tickets");
    const cookies = (res.headers["set-cookie"] as unknown as string[]).join("\n");
    expect(cookies).toMatch(/esm_sid=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
    const session = await agent.get("/bff/session").expect(200);
    expect(session.body).toMatchObject({ authenticated: true, user: { id: platformActorId("http://kc.test/realms/r", "u1"), name: "Nguyen A", username: "a" } });
    expect(csrf).toBeTruthy();
    expect(JSON.stringify(session.body)).not.toMatch(/AT-1|RT-1|IDT/);
    expect(session.headers["cache-control"]).toBe("no-store");
  });

  it("rejects a callback without the login cookie and an open-redirect returnTo", async () => {
    const { agent } = harness();
    await request(harness().app).get("/bff/callback?code=c&state=st").expect(400);
    await agent.get("/bff/login?returnTo=//evil.test").expect(302);
    const res = await agent.get("/bff/callback?code=c&state=st").expect(302);
    expect(res.headers.location).toBe("/");
  });

  it("fails closed when the identity provider rejects the callback", async () => {
    const { agent } = harness({ oidc: fakeOidc({ finishLogin: async () => { throw new Error("bad state"); } }) });
    await agent.get("/bff/login").expect(302);
    await agent.get("/bff/callback?code=c&state=wrong").expect(401);
    expect((await agent.get("/bff/session")).body.authenticated).toBe(false);
  });

  it("expires idle sessions", async () => {
    let now = 1_000_000;
    const { agent } = harness({ now: () => now });
    await login(agent);
    now += config.sessionIdleMs + 1;
    expect((await agent.get("/bff/session")).body.authenticated).toBe(false);
  });

  it("logout needs CSRF, ends the session and returns the provider logout URL", async () => {
    const { agent } = harness();
    const { csrf } = await login(agent);
    await agent.post("/bff/logout").set("Origin", ORIGIN).expect(403);
    const res = await agent.post("/bff/logout").set("Origin", ORIGIN).set("X-CSRF-Token", csrf).expect(200);
    expect(res.body.logoutUrl).toContain("id_token_hint=IDT");
    expect((await agent.get("/bff/session")).body.authenticated).toBe(false);
  });
});

describe("Platform API proxy", () => {
  const records = "/bff/api/v1/apps/it-helpdesk/entities/ticket/records";

  it("rejects unauthenticated calls", async () => {
    const { app, seen } = harness();
    const res = await request(app).get(records).expect(401);
    expect(res.body.code).toBe("SESSION_EXPIRED");
    expect(seen).toHaveLength(0);
  });

  it("forwards GET with the server-side bearer token, an allowlisted query and no cookies", async () => {
    const { agent, seen } = harness();
    await login(agent);
    await agent.get(`${records}?q=vpn&limit=20&offset=40&evil=1`).expect(200);
    expect(seen[0]?.url).toBe("https://platform.test/api/v1/apps/it-helpdesk/entities/ticket/records?q=vpn&limit=20&offset=40");
    expect(seen[0]?.headers.Authorization).toBe("Bearer AT-1");
    expect(JSON.stringify(seen[0]?.headers)).not.toMatch(/esm_sid|cookie/i);
  });

  it("does not leak upstream Set-Cookie", async () => {
    const { agent } = harness();
    await login(agent);
    const res = await agent.get(records).expect(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("requires CSRF token and same Origin for writes", async () => {
    const { agent, seen } = harness();
    const { csrf } = await login(agent);
    const body = { id: UUID, data: { title: "t" } };
    await agent.post(records).send(body).expect(403);
    await agent.post(records).set("Origin", ORIGIN).send(body).expect(403);
    await agent.post(records).set("Origin", "http://evil.test").set("X-CSRF-Token", csrf).send(body).expect(403);
    await agent.post(records).set("Origin", ORIGIN).set("X-CSRF-Token", "wrong").send(body).expect(403);
    expect(seen).toHaveLength(0);
    await agent.post(records).set("Origin", ORIGIN).set("X-CSRF-Token", csrf).send(body).expect(200);
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual(body);
  });

  it("rejects non-JSON bodies and oversized bodies", async () => {
    const { agent } = harness();
    const { csrf } = await login(agent);
    const ok = (r: request.Test) => r.set("Origin", ORIGIN).set("X-CSRF-Token", csrf);
    await ok(agent.post(records)).set("Content-Type", "text/plain").send("x").expect(415);
    await ok(agent.post(records)).set("Content-Type", "application/json").send(JSON.stringify({ pad: "x".repeat(70_000) })).expect(413);
  });

  it("serves only the allowlisted app, methods and paths", async () => {
    const { agent, seen } = harness();
    const { csrf } = await login(agent);
    const w = (r: request.Test) => r.set("Origin", ORIGIN).set("X-CSRF-Token", csrf);
    await agent.get("/bff/api/v1/apps/other-app/entities/ticket/records").expect(404);
    await w(agent.post("/bff/api/v1/apps")).send({}).expect(404);
    await agent.get("/bff/api/v1/apps/it-helpdesk/../other-app").expect(404);
    await agent.get("/bff/api/v1/apps/it-helpdesk/entities/ticket/records/not-a-uuid").expect(404);
    await w(agent.delete(records)).expect(404);
    await w(agent.put(records)).send({}).expect(404);
    await agent.get("/bff/api/v1/apps/it-helpdesk/entities/ticket/anything").expect(404);
    // Cross-app: an entity or transition of one ESM module is never reachable through the other module.
    await agent.get("/bff/api/v1/apps/hr-leave/entities/ticket/records").expect(404);
    await agent.get("/bff/api/v1/apps/it-helpdesk/entities/leaveRequest/records").expect(404);
    await w(agent.post(`/bff/api/v1/apps/hr-leave/entities/leaveRequest/records/${UUID}/transitions/start`)).send({ expectedVersion: 0 }).expect(404);
    await w(agent.post(`/bff/api/v1/apps/it-helpdesk/entities/ticket/records/${UUID}/transitions/approve`)).send({ expectedVersion: 0 }).expect(404);
    await w(agent.post(`/bff/api/v1/apps/hr-leave/entities/leaveRequest/records/${UUID}/transitions/..%2Fx`)).send({}).expect(404);
    expect(seen).toHaveLength(0);
    for (const tail of ["", "/entities/ticket", `/entities/ticket/records/${UUID}/workflow`, `/entities/ticket/records/${UUID}/history`, "/entities/ticket/audit"]) {
      await agent.get(`/bff/api/v1/apps/it-helpdesk${tail}`).expect(200);
    }
    await w(agent.post(`/bff/api/v1/apps/it-helpdesk/entities/ticket/records/${UUID}/transitions/submit`)).send({ expectedVersion: 0 }).expect(200);
    await w(agent.delete(`${records}/${UUID}?expectedVersion=3`)).expect(200);
    expect(seen.at(-1)?.url).toContain(`/records/${UUID}?expectedVersion=3`);
  });

  it("serves discovery and the HR Leave application, with the caller's own token", async () => {
    const { agent, seen } = harness();
    const { csrf } = await login(agent);
    const w = (r: request.Test) => r.set("Origin", ORIGIN).set("X-CSRF-Token", csrf);
    await agent.get("/bff/api/v1/apps").expect(200);
    await agent.get("/bff/api/v1/apps/hr-leave").expect(200);
    const hr = "/bff/api/v1/apps/hr-leave/entities/leaveRequest";
    for (const tail of ["", "/records", `/records/${UUID}`, `/records/${UUID}/workflow`, `/records/${UUID}/history`, "/audit"]) await agent.get(`${hr}${tail}`).expect(200);
    await w(agent.post(`${hr}/records`)).send({ id: UUID, data: {} }).expect(200);
    for (const transition of ["submit", "discard", "withdraw", "approve", "reject"]) {
      await w(agent.post(`${hr}/records/${UUID}/transitions/${transition}`)).send({ expectedVersion: 1 }).expect(200);
    }
    expect(seen.map((s) => s.url)).toContain("https://platform.test/api/v1/apps");
    expect(seen.map((s) => s.url)).toContain(`https://platform.test/api/v1/apps/hr-leave/entities/leaveRequest/records/${UUID}`);
    expect(seen.every((s) => s.headers.Authorization === "Bearer AT-1")).toBe(true);
  });

  it("treats a write that fails after sending as COMMIT_OUTCOME_UNKNOWN and never retries", async () => {
    const fetchImpl = vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); });
    const { agent } = harness({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { csrf } = await login(agent);
    const res = await agent.post(records).set("Origin", ORIGIN).set("X-CSRF-Token", csrf).send({ id: UUID, data: {} }).expect(503);
    expect(res.body.code).toBe("COMMIT_OUTCOME_UNKNOWN");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps ingress 502/504 to unknown outcome for writes and unavailable for reads", async () => {
    for (const status of [502, 504]) {
      const fetchImpl = (async () => new Response("Bad Gateway", { status, headers: { "content-type": "text/plain" } })) as typeof fetch;
      const { agent } = harness({ fetchImpl });
      const { csrf } = await login(agent);
      const write = await agent.post(records).set("Origin", ORIGIN).set("X-CSRF-Token", csrf).send({ id: UUID, data: {} }).expect(503);
      expect(write.body.code).toBe("COMMIT_OUTCOME_UNKNOWN");
      const read = await agent.get(records).expect(502);
      expect(read.body.code).toBe("PLATFORM_UNAVAILABLE");
    }
  });

  it("reports connection refusal as a known not-applied failure", async () => {
    const fetchImpl = vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); });
    const { agent } = harness({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { csrf } = await login(agent);
    const res = await agent.post(records).set("Origin", ORIGIN).set("X-CSRF-Token", csrf).send({ id: UUID, data: {} }).expect(502);
    expect(res.body.code).toBe("PLATFORM_UNAVAILABLE");
    expect((await agent.get(records)).status).toBe(502);
  });

  it("passes Platform errors (400/403/404/409/503) through unchanged", async () => {
    for (const status of [400, 403, 404, 409, 503]) {
      const body = JSON.stringify({ status, code: `E${status}`, message: "m", errors: { "/title": "bad" } });
      const fetchImpl = (async () => new Response(body, { status, headers: { "content-type": "application/json" } })) as typeof fetch;
      const { agent } = harness({ fetchImpl });
      await login(agent);
      const res = await agent.get(records).expect(status);
      expect(res.body.errors).toEqual({ "/title": "bad" });
    }
  });

  it("ends the session when the Platform rejects the token", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    const { agent } = harness({ fetchImpl });
    await login(agent);
    expect((await agent.get(records).expect(401)).body.code).toBe("SESSION_EXPIRED");
    expect((await agent.get("/bff/session")).body.authenticated).toBe(false);
  });

  it("refreshes a token about to expire once, and ends the session if refresh fails", async () => {
    const refresh = vi.fn(async () => ({ ...tokens(), accessToken: "AT-2" }));
    const first = harness({ oidc: fakeOidc({ finishLogin: async () => ({ tokens: tokens(5_000), user: { sub: "u", iss: "http://kc.test/realms/r", name: "n", username: "u" } }), refresh }) });
    await login(first.agent);
    await Promise.all([first.agent.get(records), first.agent.get(records)]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(first.seen.every((s) => s.headers.Authorization === "Bearer AT-2")).toBe(true);

    const failing = harness({ oidc: fakeOidc({ finishLogin: async () => ({ tokens: tokens(5_000), user: { sub: "u", iss: "http://kc.test/realms/r", name: "n", username: "u" } }), refresh: async () => { throw new Error("revoked"); } }) });
    await login(failing.agent);
    expect((await failing.agent.get(records).expect(401)).body.code).toBe("SESSION_EXPIRED");
    expect(failing.seen).toHaveLength(0);
  });

  it("sets security headers", async () => {
    const res = await request(harness().app).get("/bff/session");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });
});

describe("Platform actor id", () => {
  it("follows the documented canonical form oidc:base64url(iss).base64url(sub), unpadded (verified against a live createdBy)", () => {
    expect(platformActorId("http://localhost:8180/realms/tricore", "b042e3d9-0f24-4f99-ae37-0d09f79e4c3c")).toBe(
      "oidc:aHR0cDovL2xvY2FsaG9zdDo4MTgwL3JlYWxtcy90cmljb3Jl.YjA0MmUzZDktMGYyNC00Zjk5LWFlMzctMGQwOWY3OWU0YzNj",
    );
  });
});

describe("route allowlist helpers", () => {
  it("matches only contract routes", () => {
    const p = "/bff/api/v1/apps/it-helpdesk";
    expect(matchRoute("GET", `${p}/entities/ticket/records`)).toEqual({ upstream: "/it-helpdesk/entities/ticket/records" });
    expect(matchRoute("PATCH", `${p}/entities/ticket/records/${UUID}`)).toBeNull();
    expect(matchRoute("GET", `${p}/entities/ti%2Fcket/records`)).toBeNull();
    expect(matchRoute("GET", "/bff/api/v1/apps")).toEqual({ upstream: "" });
    expect(matchRoute("DELETE", "/bff/api/v1/apps")).toBeNull();
    expect(matchRoute("GET", "/bff/api/v1/apps/hr-leave/entities/leaveRequest/audit")).toEqual({ upstream: "/hr-leave/entities/leaveRequest/audit" });
  });
  it("keeps only contract query keys", () => {
    expect(cleanQuery(new URLSearchParams("q=a&limit=1&token=x&recordId=1"))).toBe("?q=a&limit=1&recordId=1");
    expect(cleanQuery(new URLSearchParams("x=1"))).toBe("");
  });
});

beforeEach(() => vi.restoreAllMocks());
