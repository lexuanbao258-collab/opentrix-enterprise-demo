// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { localFile } from "../support/settings";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiLogin, HR } from "../support/api";

const IDS = localFile("hr-ids.json");

test("manifest hr-leave 1.1.0 is active with the leaveRequest entity and the declared workflow", async () => {
  const manager = (await apiLogin("manager")).forApp(HR);
  const app = await manager.get("");
  expect(app.body.version).toBe("1.1.0");
  expect(app.body.entities.map((entity: { key: string }) => entity.key)).toEqual(["leaveRequest"]);
  const entity = await manager.get("/entities/leaveRequest");
  expect(entity.body.workflow.initialState).toBe("DRAFT");
  expect(entity.body.workflow.states.map((state: { id: string }) => state.id).sort()).toEqual(["APPROVED", "CANCELLED", "DRAFT", "PENDING", "REJECTED"]);
  expect(entity.body.workflow.transitions.filter((t: any) => t.notByCreator).map((t: any) => t.id).sort()).toEqual(["approve", "reject"]);
  await manager.dispose();
});

// Run `ESM_E2E_RESTART=1 npx playwright test hr-restart` after the Platform stack was stopped and started (volumes kept):
// records written by hr-flow.spec.ts must still exist with the states they had.
test("HR records written before a stack restart are unchanged after it", async () => {
  test.skip(!process.env.ESM_E2E_RESTART || !existsSync(IDS), "set ESM_E2E_RESTART=1 after a stack restart (needs .local/hr-ids.json from hr-flow.spec.ts)");
  const manager = (await apiLogin("manager")).forApp(HR);
  const saved = JSON.parse(readFileSync(IDS, "utf8")) as Record<string, { id: string; state: string }>;
  expect(Object.keys(saved).length).toBeGreaterThanOrEqual(3);
  for (const [key, expected] of Object.entries(saved)) {
    const record = await manager.get(`/entities/leaveRequest/records/${expected.id}`);
    expect(record.status, key).toBe(200);
    expect(record.body.state, key).toBe(expected.state);
  }
  await manager.dispose();
});
