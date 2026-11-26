// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiLogin, type Role } from "../support/api";
import { shot } from "../support/shots";
import { statePath } from "../support/state";

let ticketId = "";

test.beforeAll(async () => {
  const requester = await apiLogin("requester1");
  const created = await requester.create("ticket", {
    title: "Màn hình laptop nhấp nháy khi cắm dock", description: "Xảy ra khi cắm dock USB-C tại phòng họp tầng 3.\nĐã thử đổi cáp.",
    categoryCode: "HARDWARE", priority: "URGENT",
  });
  ticketId = created.body.id;
  await requester.transition("ticket", ticketId, "submit", 0);
  await requester.dispose();
});

async function open(browser: Browser, role: Role, path: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: statePath(role), locale: "vi-VN", ...test.info().project.use });
  const page = await context.newPage();
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  return { page, close: () => context.close() };
}

const PAGES: { role: Role; path: () => string; name: string }[] = [
  { role: "requester1", path: () => "/", name: "requester-dashboard" },
  { role: "requester1", path: () => "/my-requests", name: "requester-my-requests" },
  { role: "requester1", path: () => "/tickets/new", name: "requester-new" },
  { role: "requester1", path: () => `/tickets/${ticketId}`, name: "requester-detail" },
  { role: "agent", path: () => "/", name: "agent-dashboard" },
  { role: "agent", path: () => "/tickets", name: "agent-queue" },
  { role: "agent", path: () => `/tickets/${ticketId}`, name: "agent-detail" },
  { role: "admin", path: () => "/categories", name: "admin-categories" },
  { role: "admin", path: () => "/audit", name: "admin-audit" },
];

for (const entry of PAGES) {
  test(`${entry.name}: no horizontal overflow and no serious accessibility violations`, async ({ browser }, info) => {
    const { page, close } = await open(browser, entry.role, entry.path());
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    await shot(page, `layout-${info.project.name.replace("layout-", "")}-${entry.name}`, true);
    await close();
  });
}

test("mobile navigation opens and closes with the keyboard-accessible menu button", async ({ browser }, info) => {
  test.skip(info.project.name !== "layout-mobile", "mobile only");
  const { page, close } = await open(browser, "requester1", "/");
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "Mở menu" }).click();
  await expect(nav).toBeVisible();
  await page.getByRole("link", { name: "Yêu cầu của tôi" }).click();
  await expect(page.getByRole("heading", { name: "Yêu cầu của tôi" })).toBeVisible();
  await expect(nav).toBeHidden();
  await close();
});
