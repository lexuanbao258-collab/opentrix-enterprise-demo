// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiLogin, HR, type Role } from "../support/api";
import { shot } from "../support/shots";
import { statePath } from "../support/state";

let ticketId = "";
let leaveId = "";

test.beforeAll(async () => {
  const requester = await apiLogin("requester1");
  const created = await requester.create("ticket", {
    title: "Màn hình laptop nhấp nháy khi cắm dock", description: "Xảy ra khi cắm dock USB-C tại phòng họp tầng 3.\nĐã thử đổi cáp.",
    categoryCode: "HARDWARE", priority: "URGENT",
  });
  ticketId = created.body.id;
  await requester.transition("ticket", ticketId, "submit", 0);
  await requester.dispose();
  const employee = (await apiLogin("employee1")).forApp(HR);
  const leave = await employee.create("leaveRequest", { kind: "ANNUAL", startDate: "2026-12-22", days: 5, reason: "Nghỉ phép năm cùng gia đình, đã bàn giao công việc cho đồng nghiệp." });
  leaveId = leave.body.id;
  await employee.transition("leaveRequest", leaveId, "submit", 0);
  await employee.dispose();
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
  { role: "employee1", path: () => "/hr", name: "hr-employee-dashboard" },
  { role: "employee1", path: () => "/hr/my-requests", name: "hr-employee-my-requests" },
  { role: "employee1", path: () => "/hr/requests/new", name: "hr-employee-new" },
  { role: "employee1", path: () => `/hr/requests/${leaveId}`, name: "hr-employee-detail" },
  { role: "manager", path: () => "/hr", name: "hr-manager-dashboard" },
  { role: "manager", path: () => "/hr/approvals", name: "hr-manager-approvals" },
  { role: "manager", path: () => `/hr/requests/${leaveId}`, name: "hr-manager-detail" },
  { role: "auditor", path: () => "/hr/audit", name: "hr-auditor-audit" },
  { role: "dual", path: () => "/", name: "dual-both-apps" },
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

test("HR Leave: keyboard reaches the form fields in order and labels are announced", async ({ browser }) => {
  const { page, close } = await open(browser, "employee1", "/hr/requests/new");
  for (const name of ["Loại nghỉ", "Ngày bắt đầu", "Số ngày nghỉ"]) await expect(page.getByLabel(name)).toBeVisible();
  await expect(page.getByLabel("Lý do", { exact: true })).toBeVisible();
  // Tab order follows the visual order. A native date input is several tab stops (day, month, year, picker), so walk forward.
  const reach = async (label: string, exact = false) => {
    for (let step = 0; step < 8; step += 1) {
      if (await page.getByLabel(label, { exact }).evaluate((element) => element === document.activeElement || element.contains(document.activeElement))) return step;
      await page.keyboard.press("Tab");
    }
    throw new Error(`Tab never reached "${label}"`);
  };
  await page.getByLabel("Loại nghỉ").focus();
  await page.keyboard.press("Tab");
  await reach("Ngày bắt đầu");
  await reach("Số ngày nghỉ");
  await reach("Lý do", true);
  await close();
});

test("mobile: a user with both applications switches between them from the menu", async ({ browser }, info) => {
  test.skip(info.project.name !== "layout-mobile", "mobile only");
  const { page, close } = await open(browser, "dual", "/");
  await page.getByRole("button", { name: "Mở menu" }).click();
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByRole("heading", { name: "Nghỉ phép" })).toBeVisible();
  await shot(page, "layout-mobile-dual-menu");
  await nav.getByRole("link", { name: "Chờ tôi duyệt" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Chờ tôi duyệt" })).toBeVisible();
  await expect(nav).toBeHidden();
  await close();
});
