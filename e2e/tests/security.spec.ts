// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import { Api, apiLogin, BASE_URL, type Role } from "../support/api";

const RUN = Date.now().toString(36);
/** A JWT has three dot-separated base64url segments; a random CSRF token never does. */
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;
const TICKET = (suffix: string) => ({ title: `SEC ${RUN} ${suffix}`, description: "Nội dung bí mật SEC-9f3a", categoryCode: "NETWORK", priority: "NORMAL" });

const apis = {} as Record<Role, Api>;
test.beforeAll(async () => {
  for (const role of ["requester1", "requester2", "agent", "admin"] as Role[]) apis[role] = await apiLogin(role);
});
test.afterAll(async () => {
  await Promise.all(Object.values(apis).map((api) => api.dispose()));
});

async function submitted(owner: Api, suffix: string) {
  const created = await owner.create("ticket", TICKET(suffix));
  expect(created.status).toBe(201);
  const sent = await owner.transition("ticket", created.body.id, "submit", 0);
  expect(sent.status).toBe(200);
  return { id: created.body.id as string, version: sent.body.version as number };
}

test.describe("authentication", () => {
  test("unauthenticated BFF API and Platform ingress calls are rejected", async () => {
    const anonymous = await request.newContext({ baseURL: BASE_URL });
    const viaBff = await anonymous.get("/bff/api/v1/apps/it-helpdesk/entities/ticket/records", { failOnStatusCode: false });
    expect(viaBff.status()).toBe(401);
    expect((await viaBff.json()).code).toBe("SESSION_EXPIRED");
    const direct = await anonymous.get("https://localhost:8443/api/v1/apps/it-helpdesk", { ignoreHTTPSErrors: true, failOnStatusCode: false });
    expect(direct.status()).toBe(401);
    const forged = await anonymous.get("https://localhost:8443/api/v1/apps/it-helpdesk", {
      ignoreHTTPSErrors: true, failOnStatusCode: false, headers: { Authorization: "Bearer not-a-jwt" },
    });
    expect(forged.status()).toBe(401);
    expect((await anonymous.get("/bff/session")).ok()).toBeTruthy();
    expect((await (await anonymous.get("/bff/session")).json()).authenticated).toBe(false);
    await anonymous.dispose();
  });

  test("browser cookie holds no token and the session JSON carries no token", async () => {
    const state = await apis.requester1.context.storageState();
    const cookie = state.cookies.find((item) => item.name === "esm_sid");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.value).not.toMatch(JWT);
    const session = await (await apis.requester1.context.get("/bff/session")).text();
    expect(session).not.toMatch(JWT);
    expect(session).not.toMatch(/access_token|refresh_token|id_token/);
  });

  test("writes without CSRF token or with a foreign Origin are rejected", async () => {
    const url = "/bff/api/v1/apps/it-helpdesk/entities/ticket/records";
    const body = { id: randomUUID(), data: TICKET("csrf") };
    const bare = await apis.requester1.context.post(url, { data: body, failOnStatusCode: false, headers: { Origin: BASE_URL } });
    expect(bare.status()).toBe(403);
    const foreign = await apis.requester1.context.post(url, {
      data: body, failOnStatusCode: false, headers: { Origin: "https://evil.example", "X-CSRF-Token": apis.requester1.csrf },
    });
    expect(foreign.status()).toBe(403);
    const list = await apis.requester1.get(`/entities/ticket/records?q=csrf`);
    expect(list.body.items.filter((item: any) => item.data.title.includes("csrf"))).toHaveLength(0);
  });

  test("the BFF forwards only the allowlisted applications, entities and transitions (see hr-security.spec.ts for HR)", async () => {
    for (const path of [
      "/bff/api/v1/health", "/bff/api/v1/apps/other-app", "/bff/api/v1/apps/other-app/entities/ticket/records",
      "/bff/api/v1/apps/it-helpdesk/entities/leaveRequest/records", "/bff/api/v1/apps/hr-leave/entities/ticket/records",
      "/bff/api/v1/apps/it-helpdesk/entities/ticket/records/x",
    ]) {
      const response = await apis.admin.context.get(path, { failOnStatusCode: false });
      expect(response.status(), path).toBe(404);
    }
    expect((await apis.admin.raw("DELETE", "")).status).toBe(404);
  });
});

test.describe("authorization", () => {
  test("a requester cannot read, list, drive or audit another requester's ticket", async () => {
    const mine = await submitted(apis.requester1, "private");
    const read = await apis.requester2.get(`/entities/ticket/records/${mine.id}`);
    expect(read.status).toBe(404);
    expect((await apis.requester2.get(`/entities/ticket/records/${mine.id}/workflow`)).status).toBe(404);
    expect((await apis.requester2.get(`/entities/ticket/records/${mine.id}/history`)).status).toBe(404);
    expect((await apis.requester2.transition("ticket", mine.id, "cancel", mine.version)).status).toBe(404);
    expect((await apis.requester2.put(`/entities/ticket/records/${mine.id}`, { expectedVersion: mine.version, data: TICKET("x") })).status).toBe(404);
    expect((await apis.requester2.del(`/entities/ticket/records/${mine.id}?expectedVersion=${mine.version}`)).status).toBe(404);
    const list = await apis.requester2.get(`/entities/ticket/records?q=${RUN}&limit=100`);
    expect(list.body.items.map((item: any) => item.id)).not.toContain(mine.id);
    // search must not reveal hidden records through totals either
    const probe = await apis.requester2.get(`/entities/ticket/records?q=private`);
    expect(probe.body.items.some((item: any) => item.id === mine.id)).toBe(false);
    // the owner still sees it, and staff see everything
    expect((await apis.requester1.get(`/entities/ticket/records/${mine.id}`)).status).toBe(200);
    expect((await apis.agent.get(`/entities/ticket/records/${mine.id}`)).status).toBe(200);
  });

  test("role grants: requester cannot run agent transitions, agent cannot create or edit, admin cannot create", async () => {
    const t = await submitted(apis.requester1, "roles");
    expect((await apis.requester1.transition("ticket", t.id, "start", t.version)).status).toBe(403);
    expect((await apis.requester1.transition("ticket", t.id, "resolve", t.version)).status).toBe(403);
    expect((await apis.agent.create("ticket", TICKET("by-agent"))).status).toBe(403);
    expect((await apis.admin.create("ticket", TICKET("by-admin"))).status).toBe(403);
    expect((await apis.agent.put(`/entities/ticket/records/${t.id}`, { expectedVersion: t.version, data: TICKET("agent-edit") })).status).toBe(403);
    expect((await apis.agent.del(`/entities/ticket/records/${t.id}?expectedVersion=${t.version}`)).status).toBe(403);
    expect((await apis.agent.transition("ticket", t.id, "cancel", t.version)).status).toBe(403);
    // none of the refused calls changed the ticket
    const after = await apis.agent.get(`/entities/ticket/records/${t.id}`);
    expect(after.body).toMatchObject({ state: "SUBMITTED", version: t.version });
  });

  test("closing belongs to the requester: agent and other requesters cannot confirm a resolved ticket", async () => {
    const t = await submitted(apis.requester1, "confirm");
    const started = await apis.agent.transition("ticket", t.id, "start", t.version);
    const resolved = await apis.agent.transition("ticket", t.id, "resolve", started.body.version);
    expect(resolved.body.state).toBe("RESOLVED");
    expect((await apis.agent.transition("ticket", t.id, "confirm", resolved.body.version)).status).toBe(403);
    expect((await apis.admin.transition("ticket", t.id, "confirm", resolved.body.version)).status).toBe(403);
    expect((await apis.requester2.transition("ticket", t.id, "confirm", resolved.body.version)).status).toBe(404);
    const closed = await apis.requester1.transition("ticket", t.id, "confirm", resolved.body.version);
    expect(closed.status).toBe(200);
    expect(closed.body.state).toBe("CLOSED");
    // terminal: nothing moves it any more
    expect((await apis.requester1.transition("ticket", t.id, "reopen", closed.body.version)).status).toBe(409);
    expect((await apis.agent.transition("ticket", t.id, "start", closed.body.version)).status).toBe(409);
  });

  test("locked states refuse edits and deletes; invalid transitions are 409 and change nothing", async () => {
    const t = await submitted(apis.requester1, "locked");
    const put = await apis.requester1.put(`/entities/ticket/records/${t.id}`, { expectedVersion: t.version, data: TICKET("late") });
    expect(put.status).toBe(409);
    expect(put.body.code).toBe("STATE_LOCKED");
    const del = await apis.requester1.del(`/entities/ticket/records/${t.id}?expectedVersion=${t.version}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe("STATE_LOCKED");
    const early = await apis.requester1.transition("ticket", t.id, "confirm", t.version);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("TRANSITION_NOT_ALLOWED");
    expect((await apis.agent.transition("ticket", t.id, "resolve", t.version)).status).toBe(409);
    expect((await apis.requester1.transition("ticket", t.id, "does_not_exist", t.version)).status).toBe(404);
    expect((await apis.requester1.get(`/entities/ticket/records/${t.id}`)).body.version).toBe(t.version);
  });

  test("the state cannot be set through generic writes", async () => {
    const draft = await apis.requester1.create("ticket", TICKET("state-forgery"));
    const id = draft.body.id;
    for (const data of [{ ...TICKET("f"), state: "CLOSED" }, { ...TICKET("f"), workflowState: "CLOSED" }]) {
      expect((await apis.requester1.put(`/entities/ticket/records/${id}`, { expectedVersion: 0, data })).status).toBe(400);
    }
    expect((await apis.requester1.post(`/entities/ticket/records`, { id: randomUUID(), state: "CLOSED", data: TICKET("f2") })).status).toBe(400);
    expect((await apis.requester1.get(`/entities/ticket/records/${id}`)).body.state).toBe("DRAFT");
  });

  test("audit is only for administrators and redacts the description", async () => {
    const t = await submitted(apis.requester1, "audit");
    for (const role of ["requester1", "requester2", "agent"] as Role[]) {
      expect((await apis[role].get(`/entities/ticket/audit?recordId=${t.id}`)).status, role).toBe(403);
    }
    const audit = await apis.admin.get(`/entities/ticket/audit?recordId=${t.id}`);
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBe(2);
    expect(JSON.stringify(audit.body)).not.toContain("SEC-9f3a");
    expect(JSON.stringify(audit.body)).toContain("[REDACTED]");
  });

  test("category management is administrator-only on the backend", async () => {
    const data = { code: `T${RUN.toUpperCase()}`.slice(0, 12), name: "Thử nghiệm", active: true };
    for (const role of ["requester1", "agent"] as Role[]) {
      expect((await apis[role].create("category", data)).status, role).toBe(403);
      expect((await apis[role].get("/entities/category/records")).status, role).toBe(200);
    }
  });
});

test.describe("consistency", () => {
  test("a stale version is a 409 conflict and does not overwrite", async () => {
    const draft = await apis.requester1.create("ticket", TICKET("stale"));
    const id = draft.body.id;
    const first = await apis.requester1.put(`/entities/ticket/records/${id}`, { expectedVersion: 0, data: { ...TICKET("stale"), title: "SEC fresh" } });
    expect(first.status).toBe(200);
    const stale = await apis.requester1.put(`/entities/ticket/records/${id}`, { expectedVersion: 0, data: { ...TICKET("stale"), title: "SEC overwritten" } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("VERSION_CONFLICT");
    expect((await apis.requester1.transition("ticket", id, "submit", 0)).body.code).toBe("VERSION_CONFLICT");
    expect((await apis.requester1.get(`/entities/ticket/records/${id}`)).body.data.title).toBe("SEC fresh");
  });

  test("create with a client UUID is idempotent; reusing the id for another payload conflicts and another user learns nothing", async () => {
    const id = randomUUID();
    const first = await apis.requester1.create("ticket", TICKET("idem"), id);
    const again = await apis.requester1.create("ticket", TICKET("idem"), id);
    expect(first.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.version).toBe(0);
    const list = await apis.requester1.get(`/entities/ticket/records?q=idem&limit=100`);
    expect(list.body.items.filter((item: any) => item.id === id)).toHaveLength(1);
    const different = await apis.requester1.create("ticket", { ...TICKET("idem"), title: "SEC other" }, id);
    expect(different.status).toBe(409);
    expect(different.body.code).toBe("CREATE_ID_CONFLICT");
    // another user replaying the id learns nothing: the record is not visible to them (404), never a copy of it
    const other = await apis.requester2.create("ticket", TICKET("idem"), id);
    expect([404, 409]).toContain(other.status);
    expect(other.body?.data).toBeUndefined();
  });

  test("two staff members racing the same transition: exactly one winner", async () => {
    const t = await submitted(apis.requester1, "race");
    const [a, b] = await Promise.all([
      apis.agent.transition("ticket", t.id, "start", t.version),
      apis.admin.transition("ticket", t.id, "start", t.version),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const history = await apis.agent.get(`/entities/ticket/records/${t.id}/history`);
    expect(history.body.filter((item: any) => item.transitionId === "start")).toHaveLength(1);
  });

  test("validation errors are keyed by field", async () => {
    const bad = await apis.requester1.create("ticket", { title: "", description: "x", categoryCode: "bad code", priority: "NOW" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.errors).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(bad.body.errors).every((key) => key.startsWith("/"))).toBe(true);
  });
});
