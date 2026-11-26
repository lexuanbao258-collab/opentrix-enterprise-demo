// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { apiLogin } from "../support/api";
import { shot } from "../support/shots";
import { statePath } from "../support/state";

// Stops and starts the Platform backend container of the local stack. Opt-in: ESM_E2E_OUTAGE=1.
test.skip(!process.env.ESM_E2E_OUTAGE, "set ESM_E2E_OUTAGE=1 to run the backend outage scenario");
test.describe.configure({ mode: "serial" });
test.use({ storageState: statePath("requester1") });

const BACKEND = `${process.env.ESM_STACK_PROJECT ?? "opentrix-esm"}-backend-1`;
const docker = (...args: string[]) => execFileSync("docker", args, { stdio: "pipe" }).toString();
const TITLE = `Mất kết nối giữa chừng ${Date.now().toString(36)}`;

test.afterAll(() => {
  docker("start", BACKEND);
});

test("a create that loses the Platform is reported as unknown, reconciled by reading, then retried once with the same id", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/tickets/new");
  await page.getByLabel("Tiêu đề").fill(TITLE);
  await page.getByLabel("Danh mục").selectOption({ label: "Mạng và VPN" });
  await page.getByLabel("Mô tả chi tiết").fill("Ghi nhận khi backend ngừng hoạt động.");

  docker("stop", BACKEND);
  await page.getByRole("button", { name: "Lưu nháp" }).click();
  await expect(page.getByText("Chưa xác nhận được kết quả")).toBeVisible();
  await expect(page.getByLabel("Tiêu đề")).toBeDisabled();
  await shot(page, "12-outcome-unknown");

  docker("start", BACKEND);
  const requester = await apiLogin("requester1");
  await expect.poll(async () => (await requester.get("")).status, { timeout: 120_000, intervals: [2000] }).toBe(200);

  await page.getByRole("button", { name: "Kiểm tra trạng thái" }).click();
  await expect(page.getByText(/phiếu chưa được tạo/)).toBeVisible();
  await page.getByRole("button", { name: "Gửi lại với cùng mã yêu cầu" }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  await expect(page.locator("[data-state='DRAFT']")).toBeVisible();

  const list = await requester.get(`/entities/ticket/records?q=${encodeURIComponent(TITLE)}&limit=100`);
  expect(list.body.items.filter((item: { data: { title: string } }) => item.data.title === TITLE)).toHaveLength(1);
  await requester.dispose();
});

test("a write during an outage is never reported as plain success or failure", async () => {
  const requester = await apiLogin("requester1");
  const created = await requester.create("ticket", { title: `Outage API ${Date.now()}`, description: "x", categoryCode: "NETWORK", priority: "LOW" });
  expect(created.status).toBe(201);
  docker("stop", BACKEND);
  try {
    const during = await requester.transition("ticket", created.body.id, "submit", 0);
    expect(during.status).toBe(503);
    expect(during.body.code).toBe("COMMIT_OUTCOME_UNKNOWN");
    const read = await requester.get(`/entities/ticket/records/${created.body.id}`);
    expect(read.status).toBe(502);
  } finally {
    docker("start", BACKEND);
  }
  await expect.poll(async () => (await requester.get(`/entities/ticket/records/${created.body.id}`)).status, { timeout: 120_000, intervals: [2000] }).toBe(200);
  const after = await requester.get(`/entities/ticket/records/${created.body.id}`);
  expect(after.body).toMatchObject({ state: "DRAFT", version: 0 }); // the unknown write did not happen, and nothing was repeated
  await requester.dispose();
});
