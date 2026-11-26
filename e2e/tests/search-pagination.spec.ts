// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Page } from "@playwright/test";
import { Api, apiLogin } from "../support/api";
import { shot } from "../support/shots";
import { statePath } from "../support/state";

const RUN = `PG${Date.now().toString(36)}`;
const TOTAL = 45;
let owner: Api;

test.use({ storageState: statePath("requester2") });

/** Types a query and waits for the debounced server request that carries it (no sleeping). */
async function search(page: Page, text: string) {
  const sent = page.waitForResponse((response) => new URL(response.url()).searchParams.get("q") === text);
  await page.getByRole("searchbox").fill(text);
  await sent;
}

test.beforeAll(async () => {
  owner = await apiLogin("requester2");
  for (let index = 1; index <= TOTAL; index++) {
    const word = index % 3 === 0 ? "alpha" : "beta";
    const created = await owner.create("ticket", {
      title: `${RUN} ${word} số ${String(index).padStart(2, "0")}`, description: `mô tả ${index}`,
      categoryCode: index % 2 ? "NETWORK" : "HARDWARE", priority: "NORMAL",
    });
    expect(created.status).toBe(201);
    if (index <= 4) expect((await owner.transition("ticket", created.body.id, "submit", 0)).status).toBe(200);
  }
});
test.afterAll(() => owner.dispose());

test("server-side search and pagination over real data", async ({ page }) => {
  await page.goto("/my-requests");
  await search(page, RUN);
  await expect(page.getByText(`1–20 trên ${TOTAL}`)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(20);
  await shot(page, "10-pagination-page1");
  await page.getByRole("button", { name: "Sau" }).click();
  await expect(page.getByText(`21–40 trên ${TOTAL}`)).toBeVisible();
  await page.getByRole("button", { name: "Sau" }).click();
  await expect(page.getByText(`41–${TOTAL} trên ${TOTAL}`)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(TOTAL - 40);
  await expect(page.getByRole("button", { name: "Sau" })).toBeDisabled();
  await page.getByRole("button", { name: "Trước" }).click();
  await expect(page.getByText(`21–40 trên ${TOTAL}`)).toBeVisible();

  await search(page, `${RUN} alpha`);
  await expect(page.getByText("1–15 trên 15")).toBeVisible();
  await search(page, `${RUN} không-tồn-tại`);
  await expect(page.getByText("Chưa có phiếu nào phù hợp.")).toBeVisible();
});

test("state filter scans authorized records and agrees with the API", async ({ page }) => {
  await page.goto("/my-requests");
  await search(page, RUN);
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("SUBMITTED");
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await page.getByLabel("Trạng thái", { exact: true }).selectOption("DRAFT");
  await expect(page.getByText(`1–20 trên ${TOTAL - 4}`)).toBeVisible();
});

test("dashboard counts equal what the API authorizes, and the scope is stated", async ({ page }) => {
  const all: { state: string }[] = [];
  for (let offset = 0; ; offset += 100) {
    const reply = await owner.get(`/entities/ticket/records?limit=100&offset=${offset}`);
    all.push(...reply.body.items);
    if (offset + 100 >= reply.body.total) break;
  }
  const drafts = all.filter((item) => item.state === "DRAFT").length;
  const sent = all.filter((item) => ["SUBMITTED", "IN_PROGRESS"].includes(item.state)).length;
  await page.goto("/");
  await expect(page.getByTestId("tile-DRAFT")).toContainText(String(drafts));
  await expect(page.getByTestId("tile-SUBMITTED")).toContainText(String(sent));
  await expect(page.getByTestId("scope-note")).toContainText(String(all.length));
  await shot(page, "11-requester-dashboard");
});
