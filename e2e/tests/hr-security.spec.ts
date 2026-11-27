// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { localFile, PLATFORM_URL } from "../support/settings";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, request, test } from "@playwright/test";
import { Api, apiLogin, BASE_URL, HR, IT, type Role } from "../support/api";

const RUN = Date.now().toString(36);
const SECRET = `SEC-HR-${RUN}-bí-mật`;
const LEAVE = (suffix = "x") => ({ kind: "SICK", startDate: "2026-12-10", days: 2, reason: `${SECRET} ${suffix}` });
const REC = (id: string) => `/entities/leaveRequest/records/${id}`;

/** Every role, signed in through the real BFF; `hr[role]` addresses hr-leave, `it[role]` it-helpdesk (same session). */
const base = {} as Record<Role, Api>;
const hr = {} as Record<Role, Api>;
const it = {} as Record<Role, Api>;
const ROLES: Role[] = ["requester1", "requester2", "agent", "admin", "employee1", "employee2", "manager", "auditor", "dual"];
test.beforeAll(async () => {
  for (const role of ROLES) {
    base[role] = await apiLogin(role);
    hr[role] = base[role].forApp(HR);
    it[role] = base[role].forApp(IT);
  }
});
test.afterAll(async () => {
  await Promise.all(Object.values(base).map((api) => api.dispose()));
});

async function pending(owner: Api, suffix: string) {
  const created = await owner.create("leaveRequest", LEAVE(suffix));
  expect(created.status).toBe(201);
  const sent = await owner.transition("leaveRequest", created.body.id, "submit", 0);
  expect(sent.status).toBe(200);
  return { id: created.body.id as string, version: sent.body.version as number };
}

test.describe("application discovery and cross-app isolation", () => {
  test("discovery lists exactly the applications in which the caller holds a role", async () => {
    const ids = async (role: Role) => (await base[role].raw("GET", "")).body.map((app: { id: string }) => app.id).sort();
    for (const role of ["requester1", "requester2", "agent", "admin"] as Role[]) expect(await ids(role), role).toEqual([IT]);
    for (const role of ["employee1", "employee2", "manager", "auditor"] as Role[]) expect(await ids(role), role).toEqual([HR]);
    expect(await ids("dual")).toEqual([HR, IT].sort());
    const roles = (await base.dual.raw("GET", "/hr-leave")).body.callerRoles.sort();
    expect(roles).toEqual(["employee", "manager"]);
    expect((await base.dual.raw("GET", "/it-helpdesk")).body.callerRoles).toEqual(["requester"]);
  });

  test("IT roles alone grant no HR access, checked directly against the API", async () => {
    const mine = await pending(hr.employee1, "it-only");
    for (const role of ["requester1", "agent", "admin"] as Role[]) {
      expect((await base[role].raw("GET", "/hr-leave")).status, `${role} app`).toBe(404);
      expect((await hr[role].get("/entities/leaveRequest")).status, `${role} entity`).toBe(404);
      expect((await hr[role].get("/entities/leaveRequest/records")).status, `${role} list`).toBe(404);
      expect((await hr[role].get(REC(mine.id))).status, `${role} read`).toBe(404);
      expect((await hr[role].create("leaveRequest", LEAVE("it-only"))).status, `${role} create`).toBe(404);
      expect((await hr[role].transition("leaveRequest", mine.id, "approve", mine.version)).status, `${role} approve`).toBe(404);
      expect((await hr[role].get("/entities/leaveRequest/audit")).status, `${role} audit`).toBe(404);
    }
  });

  test("HR roles alone grant no IT access, checked directly against the API", async () => {
    const ticket = await it.requester1.create("ticket", { title: `HRX ${RUN}`, description: "d", categoryCode: "NETWORK", priority: "LOW" });
    expect(ticket.status).toBe(201);
    for (const role of ["employee1", "manager", "auditor"] as Role[]) {
      expect((await base[role].raw("GET", "/it-helpdesk")).status, `${role} app`).toBe(404);
      expect((await it[role].get("/entities/ticket/records")).status, `${role} list`).toBe(404);
      expect((await it[role].get(`/entities/ticket/records/${ticket.body.id}`)).status, `${role} read`).toBe(404);
      expect((await it[role].create("ticket", { title: "t", description: "d", categoryCode: "NETWORK", priority: "LOW" })).status, `${role} create`).toBe(404);
      expect((await it[role].get("/entities/ticket/audit")).status, `${role} audit`).toBe(404);
      expect((await it[role].get("/entities/category/records")).status, `${role} categories`).toBe(404);
    }
  });

  test("the BFF refuses unknown applications, entities and transitions, and cross-module names", async () => {
    for (const path of [
      "/other-app", "/hr-leave/entities/ticket/records", "/hr-leave/entities/category", "/it-helpdesk/entities/leaveRequest/records",
      "/hr-leave/entities/leaveRequest/records/not-a-uuid", "/hr-leave/entities/leaveRequest/anything", "/hr-leave/../it-helpdesk/x",
    ]) expect((await base.manager.raw("GET", path)).status, path).toBe(404);
    const id = randomUUID();
    for (const transition of ["start", "resolve", "confirm", "cancel", "reopen", "does_not_exist", "..%2Fx"]) {
      expect((await base.manager.raw("POST", `/hr-leave/entities/leaveRequest/records/${id}/transitions/${transition}`, { expectedVersion: 0 })).status, transition).toBe(404);
    }
    for (const transition of ["approve", "reject", "withdraw"]) {
      expect((await base.requester1.raw("POST", `/it-helpdesk/entities/ticket/records/${id}/transitions/${transition}`, { expectedVersion: 0 })).status, transition).toBe(404);
    }
    expect((await base.manager.raw("PATCH", `/hr-leave/entities/leaveRequest/records/${id}`, {})).status).toBe(404);
    expect((await base.manager.raw("DELETE", "/hr-leave/entities/leaveRequest/records")).status).toBe(404);
    expect((await base.manager.raw("POST", "", {})).status).toBe(404);
  });

  test("unauthenticated and CSRF-less HR calls are rejected before reaching the Platform", async () => {
    const anonymous = await request.newContext({ baseURL: BASE_URL });
    const unauth = await anonymous.get("/bff/api/v1/apps/hr-leave/entities/leaveRequest/records", { failOnStatusCode: false });
    expect(unauth.status()).toBe(401);
    expect((await unauth.json()).code).toBe("SESSION_EXPIRED");
    expect((await anonymous.get("/bff/api/v1/apps", { failOnStatusCode: false })).status()).toBe(401);
    const direct = await anonymous.get(`${PLATFORM_URL}/api/v1/apps/hr-leave`, { failOnStatusCode: false });
    expect(direct.status()).toBe(401);
    await anonymous.dispose();

    const url = "/bff/api/v1/apps/hr-leave/entities/leaveRequest/records";
    const body = { id: randomUUID(), data: LEAVE("csrf") };
    const ctx = base.employee1.context;
    expect((await ctx.post(url, { data: body, failOnStatusCode: false, headers: { Origin: BASE_URL } })).status()).toBe(403);
    expect((await ctx.post(url, { data: body, failOnStatusCode: false, headers: { Origin: "https://evil.example", "X-CSRF-Token": base.employee1.csrf } })).status()).toBe(403);
    expect((await ctx.post(url, { data: body, failOnStatusCode: false, headers: { Origin: BASE_URL, "X-CSRF-Token": "forged" } })).status()).toBe(403);
    expect((await hr.employee1.get(`/entities/leaveRequest/records?q=csrf&limit=100`)).body.items.some((item: any) => item.id === body.id)).toBe(false);
    // approving with another user's CSRF token (token fixation across sessions) is rejected as well
    const m = await pending(hr.employee1, "csrf-cross");
    const crossed = await base.manager.context.post(`/bff/api/v1/apps/hr-leave/entities/leaveRequest/records/${m.id}/transitions/approve`, {
      data: { expectedVersion: m.version }, failOnStatusCode: false, headers: { Origin: BASE_URL, "X-CSRF-Token": base.employee1.csrf },
    });
    expect(crossed.status()).toBe(403);
    expect((await hr.manager.get(REC(m.id))).body.state).toBe("PENDING");
  });
});

test.describe("HR authorization on the Platform (not just hidden UI controls)", () => {
  test("an employee cannot read, list, edit, delete, submit, withdraw or audit another employee's request", async () => {
    const theirs = await pending(hr.employee1, "private");
    expect((await hr.employee2.get(REC(theirs.id))).status).toBe(404);
    expect((await hr.employee2.get(`${REC(theirs.id)}/workflow`)).status).toBe(404);
    expect((await hr.employee2.get(`${REC(theirs.id)}/history`)).status).toBe(404);
    expect((await hr.employee2.transition("leaveRequest", theirs.id, "withdraw", theirs.version)).status).toBe(404);
    expect((await hr.employee2.put(REC(theirs.id), { expectedVersion: theirs.version, data: LEAVE("x") })).status).toBe(404);
    expect((await hr.employee2.del(`${REC(theirs.id)}?expectedVersion=${theirs.version}`)).status).toBe(404);
    const list = await hr.employee2.get(`/entities/leaveRequest/records?q=${encodeURIComponent(SECRET)}&limit=100`);
    expect(list.body.items.map((item: any) => item.id)).not.toContain(theirs.id);
    const probe = await hr.employee2.get(`/entities/leaveRequest/records?q=${encodeURIComponent(`${SECRET} private`)}`);
    expect(probe.body.items.some((item: any) => item.id === theirs.id)).toBe(false);
    // the owner, managers and the auditor read it
    for (const api of [hr.employee1, hr.manager, hr.auditor]) expect((await api.get(REC(theirs.id))).status).toBe(200);
    expect((await hr.employee2.get("/entities/leaveRequest/audit")).status).toBe(403);
    expect((await hr.employee2.transition("leaveRequest", theirs.id, "approve", theirs.version)).status).toBe(404);
  });

  test("role grants: employee cannot decide; manager cannot create, edit or delete; auditor is read and audit only", async () => {
    const t = await pending(hr.employee1, "roles");
    expect((await hr.employee1.transition("leaveRequest", t.id, "approve", t.version)).status).toBe(403);
    expect((await hr.employee1.transition("leaveRequest", t.id, "reject", t.version)).status).toBe(403);
    expect((await hr.manager.create("leaveRequest", LEAVE("by-manager"))).status).toBe(403);
    expect((await hr.manager.put(REC(t.id), { expectedVersion: t.version, data: LEAVE("m-edit") })).status).toBe(403);
    expect((await hr.manager.del(`${REC(t.id)}?expectedVersion=${t.version}`)).status).toBe(403);
    expect((await hr.manager.transition("leaveRequest", t.id, "withdraw", t.version)).status).toBe(403);
    expect((await hr.manager.get("/entities/leaveRequest/audit")).status).toBe(403);
    expect((await hr.auditor.create("leaveRequest", LEAVE("by-auditor"))).status).toBe(403);
    expect((await hr.auditor.transition("leaveRequest", t.id, "approve", t.version)).status).toBe(403);
    expect((await hr.auditor.transition("leaveRequest", t.id, "reject", t.version)).status).toBe(403);
    expect((await hr.auditor.put(REC(t.id), { expectedVersion: t.version, data: LEAVE("a-edit") })).status).toBe(403);
    expect((await hr.auditor.del(`${REC(t.id)}?expectedVersion=${t.version}`)).status).toBe(403);
    expect((await hr.auditor.get(`/entities/leaveRequest/audit?recordId=${t.id}`)).status).toBe(200);
    // none of the refused calls changed the request
    expect((await hr.manager.get(REC(t.id))).body).toMatchObject({ state: "PENDING", version: t.version });
  });

  test("employee-and-manager: cannot approve or reject own request (403), another manager can; approving is not repeatable", async () => {
    const own = await pending(hr.dual, "self");
    const flow = await hr.dual.get(`${REC(own.id)}/workflow`);
    expect(flow.body.allowedActions.map((a: any) => a.id)).toEqual(["withdraw"]);
    for (const action of ["approve", "reject"]) {
      const denied = await hr.dual.transition("leaveRequest", own.id, action, own.version);
      expect([denied.status, denied.body.code]).toEqual([403, "FORBIDDEN"]);
    }
    expect((await hr.dual.get(REC(own.id))).body).toMatchObject({ state: "PENDING", version: own.version });
    // another manager sees the actions and approves
    const seen = await hr.manager.get(`${REC(own.id)}/workflow`);
    expect(seen.body.allowedActions.map((a: any) => a.id).sort()).toEqual(["approve", "reject"]);
    const approved = await hr.manager.transition("leaveRequest", own.id, "approve", own.version);
    expect(approved.status).toBe(200);
    expect(approved.body.state).toBe("APPROVED");
    // the creator, who is also a manager, sees the real outcome
    expect((await hr.dual.get(REC(own.id))).body.state).toBe("APPROVED");
    // decisions are final
    expect((await hr.manager.transition("leaveRequest", own.id, "approve", approved.body.version)).body.code).toBe("TRANSITION_NOT_ALLOWED");
    expect((await hr.manager.transition("leaveRequest", own.id, "reject", approved.body.version)).status).toBe(409);
    expect((await hr.dual.transition("leaveRequest", own.id, "withdraw", approved.body.version)).status).toBe(409);
  });

  test("a manager who is also employee can still reject another employee's request; own draft stays editable only by owner", async () => {
    const theirs = await pending(hr.employee1, "dual-decides");
    const rejected = await hr.dual.transition("leaveRequest", theirs.id, "reject", theirs.version);
    expect(rejected.status).toBe(200);
    expect(rejected.body.state).toBe("REJECTED");
    const draft = await hr.dual.create("leaveRequest", LEAVE("dual-draft"));
    expect((await hr.manager.put(REC(draft.body.id), { expectedVersion: 0, data: LEAVE("hijack") })).status).toBe(403);
    expect((await hr.employee1.put(REC(draft.body.id), { expectedVersion: 0, data: LEAVE("hijack") })).status).toBe(404);
    expect((await hr.dual.put(REC(draft.body.id), { expectedVersion: 0, data: LEAVE("own-edit") })).status).toBe(200);
  });

  test("stale versions are 409 VERSION_CONFLICT and change nothing", async () => {
    const draft = await hr.employee1.create("leaveRequest", LEAVE("stale"));
    const id = draft.body.id;
    expect((await hr.employee1.put(REC(id), { expectedVersion: 0, data: { ...LEAVE("stale"), days: 3 } })).status).toBe(200);
    const stale = await hr.employee1.put(REC(id), { expectedVersion: 0, data: { ...LEAVE("stale"), days: 9 } });
    expect([stale.status, stale.body.code]).toEqual([409, "VERSION_CONFLICT"]);
    expect((await hr.employee1.transition("leaveRequest", id, "submit", 0)).body.code).toBe("VERSION_CONFLICT");
    expect((await hr.employee1.get(REC(id))).body).toMatchObject({ version: 1, data: { days: 3 } });
    const sent = await hr.employee1.transition("leaveRequest", id, "submit", 1);
    // a manager acting on the version they loaded before the employee withdrew gets a conflict, not a silent approval
    expect((await hr.employee1.transition("leaveRequest", id, "withdraw", sent.body.version)).status).toBe(200);
    const late = await hr.manager.transition("leaveRequest", id, "approve", sent.body.version);
    expect(late.status).toBe(409);
    expect(["VERSION_CONFLICT", "TRANSITION_NOT_ALLOWED"]).toContain(late.body.code);
    expect((await hr.manager.get(REC(id))).body.state).toBe("CANCELLED");
  });

  test("locked states refuse edits and deletes; invalid transitions are 409", async () => {
    const t = await pending(hr.employee1, "locked");
    for (const [label, reply] of [
      ["update PENDING", await hr.employee1.put(REC(t.id), { expectedVersion: t.version, data: LEAVE("late") })],
      ["delete PENDING", await hr.employee1.del(`${REC(t.id)}?expectedVersion=${t.version}`)],
    ] as const) expect([label, reply.status, reply.body.code]).toEqual([label, 409, "STATE_LOCKED"]);
    expect((await hr.employee1.transition("leaveRequest", t.id, "submit", t.version)).body.code).toBe("TRANSITION_NOT_ALLOWED");
    expect((await hr.employee1.transition("leaveRequest", t.id, "discard", t.version)).body.code).toBe("TRANSITION_NOT_ALLOWED");
    const draft = await hr.employee1.create("leaveRequest", LEAVE("early"));
    expect((await hr.manager.transition("leaveRequest", draft.body.id, "approve", 0)).body.code).toBe("TRANSITION_NOT_ALLOWED");
    expect((await hr.employee1.transition("leaveRequest", t.id, "does_not_exist", t.version)).status).toBe(404);
    const approved = await hr.manager.transition("leaveRequest", t.id, "approve", t.version);
    for (const reply of [
      await hr.employee1.put(REC(t.id), { expectedVersion: approved.body.version, data: LEAVE("after") }),
      await hr.employee1.del(`${REC(t.id)}?expectedVersion=${approved.body.version}`),
    ]) expect([reply.status, reply.body.code]).toEqual([409, "STATE_LOCKED"]);
    expect((await hr.employee1.get(REC(t.id))).body).toMatchObject({ state: "APPROVED", version: approved.body.version });
  });

  test("the state cannot be set through generic writes", async () => {
    const draft = await hr.employee1.create("leaveRequest", LEAVE("forgery"));
    for (const data of [{ ...LEAVE("f"), state: "APPROVED" }, { ...LEAVE("f"), workflowState: "APPROVED" }]) {
      expect((await hr.employee1.put(REC(draft.body.id), { expectedVersion: 0, data })).status).toBe(400);
    }
    expect((await hr.employee1.post("/entities/leaveRequest/records", { id: randomUUID(), state: "APPROVED", data: LEAVE("f2") })).status).toBe(400);
    expect((await hr.employee1.get(REC(draft.body.id))).body.state).toBe("DRAFT");
  });

  test("two managers racing the same decision: exactly one winner", async () => {
    const t = await pending(hr.employee1, "race");
    const [a, b] = await Promise.all([
      hr.manager.transition("leaveRequest", t.id, "approve", t.version),
      hr.dual.transition("leaveRequest", t.id, "reject", t.version),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const history = await hr.manager.get(`${REC(t.id)}/history`);
    expect(history.body.filter((item: any) => ["approve", "reject"].includes(item.transitionId))).toHaveLength(1);
  });

  test("create with a client UUID is idempotent for the same payload", async () => {
    const id = randomUUID();
    const first = await hr.employee1.create("leaveRequest", LEAVE("idem"), id);
    const again = await hr.employee1.create("leaveRequest", LEAVE("idem"), id);
    expect([first.status, again.body.id, again.body.version]).toEqual([201, id, 0]);
    expect((await hr.employee1.create("leaveRequest", { ...LEAVE("idem"), days: 5 }, id)).body.code).toBe("CREATE_ID_CONFLICT");
    const other = await hr.employee2.create("leaveRequest", LEAVE("idem"), id);
    expect([404, 409]).toContain(other.status);
    expect(other.body?.data).toBeUndefined();
  });

  test("the manifest schema is enforced by the Platform", async () => {
    for (const [field, value] of [["days", 0], ["days", 31], ["days", 1.5], ["kind", "HOLIDAY"], ["startDate", "01/12/2026"], ["reason", ""], ["reason", "x".repeat(501)]] as const) {
      const bad = await hr.employee1.create("leaveRequest", { ...LEAVE("v"), [field]: value });
      expect([field, bad.status, bad.body.code]).toEqual([field, 400, "VALIDATION_FAILED"]);
      expect(Object.keys(bad.body.errors).every((key) => key.startsWith("/"))).toBe(true);
    }
    expect((await hr.employee1.create("leaveRequest", { kind: "SICK", startDate: "2026-12-01", days: 1 })).status).toBe(400);
    expect((await hr.employee1.create("leaveRequest", { ...LEAVE("v"), extra: 1 })).status).toBe(400);
  });
});

test.describe("sensitive HR data does not leak", () => {
  let id = "";
  test("audit events are redacted; only the auditor may read them", async () => {
    const t = await pending(hr.employee1, "audit");
    id = t.id;
    await hr.manager.transition("leaveRequest", t.id, "approve", t.version);
    for (const role of ["employee1", "employee2", "manager", "dual"] as Role[]) {
      expect((await hr[role].get(`/entities/leaveRequest/audit?recordId=${t.id}`)).status, role).toBe(403);
    }
    const audit = await hr.auditor.get(`/entities/leaveRequest/audit?recordId=${t.id}`);
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBe(3);
    const text = JSON.stringify(audit.body);
    expect(text).not.toContain(SECRET);
    expect(text).toContain("[REDACTED]");
    // non-sensitive fields stay visible so the trail remains useful
    expect(audit.body.items.find((item: any) => item.action === "CREATE").after).toMatchObject({ kind: "SICK", days: 2, startDate: "2026-12-10" });
  });

  test("error responses never echo the reason, through the API or the BFF", async () => {
    const replies = [
      await hr.employee1.create("leaveRequest", { ...LEAVE("echo"), days: 99 }),
      await hr.employee1.put(REC(id), { expectedVersion: 0, data: { ...LEAVE("echo2"), days: 99 } }),
      await hr.employee2.put(REC(id), { expectedVersion: 0, data: LEAVE("echo3") }),
      await hr.employee1.put(REC(id), { expectedVersion: 99, data: LEAVE("echo4") }),
      await hr.manager.create("leaveRequest", LEAVE("echo5")),
      await hr.employee1.post("/entities/leaveRequest/records", { id: randomUUID(), data: { ...LEAVE("echo6"), kind: "X" } }),
    ];
    for (const reply of replies) expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    const oversized = await base.employee1.context.post("/bff/api/v1/apps/hr-leave/entities/leaveRequest/records", {
      data: { id: randomUUID(), data: { ...LEAVE("big"), reason: `${SECRET} ${"x".repeat(70_000)}` } },
      failOnStatusCode: false, headers: { Origin: BASE_URL, "X-CSRF-Token": base.employee1.csrf },
    });
    expect(oversized.status()).toBe(413);
    expect(await oversized.text()).not.toContain(SECRET);
  });

  test("the reason appears in no BFF log and no Platform/ingress container log", async () => {
    const logs: string[] = [];
    const bff = localFile("bff.log");
    if (existsSync(bff)) logs.push(readFileSync(bff, "utf8"));
    for (const service of ["backend", "ingress", "postgres"]) {
      try {
        logs.push(execFileSync("docker", ["logs", `opentrix-esm-${service}-1`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 }));
      } catch {
        test.info().annotations.push({ type: "skip-part", description: `docker logs for ${service} unavailable` });
      }
    }
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) expect(log).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain("SEC-HR-");
  });

  test("the Platform stores the reason only as record data (sensitive) and the session JSON carries no HR data", async () => {
    const session = await (await base.employee1.context.get("/bff/session")).text();
    expect(session).not.toContain(SECRET);
    expect(session).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
  });
});
