// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { localFile } from "../support/settings";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiLogin } from "../support/api";

const SEED = localFile("seed-v1.json");

test("manifest 1.1.0 is active with the ticket entity", async () => {
  const admin = await apiLogin("admin");
  const app = await admin.get("");
  expect(app.body.version).toBe("1.1.0");
  expect(app.body.entities.map((entity: { key: string }) => entity.key).sort()).toEqual(["category", "ticket"]);
  const ticket = await admin.get("/entities/ticket");
  expect(ticket.body.workflow.initialState).toBe("DRAFT");
  expect(ticket.body.workflow.states.map((state: { id: string }) => state.id).sort())
    .toEqual(["CANCELLED", "CLOSED", "DRAFT", "IN_PROGRESS", "RESOLVED", "SUBMITTED"]);
  await admin.dispose();
});

test("categories written under manifest 1.0.0 are unchanged after the upgrade", async () => {
  test.skip(!process.env.ESM_E2E_UPGRADE || !existsSync(SEED), "set ESM_E2E_UPGRADE=1 on a stack seeded under 1.0.0 (e2e/scripts/seed-v1-data.ts) then upgraded");
  const admin = await apiLogin("admin");
  const seeded = JSON.parse(readFileSync(SEED, "utf8")) as Record<string, { id: string; version: number }>;
  for (const [code, expected] of Object.entries(seeded)) {
    const record = await admin.get(`/entities/category/records/${expected.id}`);
    expect(record.status, code).toBe(200);
    expect(record.body.data.code).toBe(code);
    expect(record.body.version, `${code} version`).toBe(expected.version);
  }
  const page = await admin.get("/entities/category/records?limit=100");
  expect(page.body.total).toBeGreaterThanOrEqual(Object.keys(seeded).length);
  await admin.dispose();
});
