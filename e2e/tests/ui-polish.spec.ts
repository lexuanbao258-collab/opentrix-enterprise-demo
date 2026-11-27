// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
// M6.2: behavior added by the UI polish. Business rules stay covered by the flow and security specs.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiLogin, HR, type Role } from "../support/api";
import { statePath } from "../support/state";

async function as<T>(browser: Browser, role: Role, body: (page: Page) => Promise<T>, options: Parameters<Browser["newContext"]>[0] = {}): Promise<T> {
  const context = await browser.newContext({ storageState: statePath(role), locale: "vi-VN", ...options });
  const page = await context.newPage();
  try {
    return await body(page);
  } finally {
    await context.close();
  }
}

const RUN = Date.now().toString(36);

test("a user with both applications switches module from the header and the current module is marked", async ({ browser }) => {
  await as(browser, "dual", async (page) => {
    await page.goto("/");
    const switcher = page.getByRole("navigation", { name: "Chuyển ứng dụng" });
    await expect(switcher.getByRole("link", { name: "Hỗ trợ CNTT" })).toHaveAttribute("aria-current", "true");
    await expect(switcher.getByRole("link", { name: "Nghỉ phép" })).not.toHaveAttribute("aria-current", "true");
    await switcher.getByRole("link", { name: "Nghỉ phép" }).click();
    await expect(page).toHaveURL(/\/hr$/);
    await expect(switcher.getByRole("link", { name: "Nghỉ phép" })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("heading", { level: 1, name: "Tổng quan nghỉ phép" })).toBeVisible();
  });
});

test("a single-application user gets no switcher, only the module name", async ({ browser }) => {
  await as(browser, "requester1", async (page) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Chuyển ứng dụng" })).toHaveCount(0);
    await expect(page.locator(".module-label")).toHaveText("Hỗ trợ CNTT");
  });
});

test("mobile menu: Escape closes it and returns focus to the menu button; the page behind does not scroll", async ({ browser }) => {
  await as(browser, "requester1", async (page) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    const menu = page.getByRole("button", { name: "Mở menu" });
    await menu.click();
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "Đóng menu" }).first()).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    // sign-out stays reachable from the menu
    await menu.click();
    await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  }, { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
});

test("dashboard: the attention list and the state tiles are real links into the filtered list", async ({ browser }) => {
  const requester = await apiLogin("requester1");
  const title = `Đăng nhập VPN lỗi ${RUN}`;
  const created = await requester.create("ticket", { title, description: "Không đăng nhập được VPN.", categoryCode: "NETWORK", priority: "URGENT" });
  expect(created.status).toBe(201);
  await requester.dispose();
  await as(browser, "requester1", async (page) => {
    await page.goto("/");
    // a draft belongs in the "needs you" list of its owner
    await expect(page.getByRole("region", { name: /Cần bạn thao tác/ }).getByRole("link", { name: title })).toBeVisible();
    await page.getByTestId("tile-DRAFT").click();
    await expect(page).toHaveURL(/\/my-requests\?state=DRAFT$/);
    await expect(page.getByLabel("Trạng thái")).toHaveValue("DRAFT");
    await page.getByRole("searchbox").fill(title);
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  });
});

test("HR: ending actions are separated, never primary, and ask for confirmation", async ({ browser }) => {
  const employee = (await apiLogin("employee1")).forApp(HR);
  const created = await employee.create("leaveRequest", { kind: "ANNUAL", startDate: "2027-03-01", days: 2, reason: `Việc gia đình ${RUN}` });
  expect(created.status).toBe(201);
  await employee.transition("leaveRequest", created.body.id, "submit", 0);
  await employee.dispose();
  await as(browser, "employee1", async (page) => {
    await page.goto(`/hr/requests/${created.body.id}`);
    await expect(page.getByTestId("status-banner")).toContainText("Chờ duyệt");
    await expect(page.getByText("01/03/2027")).toBeVisible(); // dd/mm/yyyy, not ISO
    const withdraw = page.getByRole("button", { name: "Rút đơn" });
    await expect(withdraw).toHaveClass(/btn-danger/);
    await expect(withdraw).not.toHaveClass(/btn-primary/);
    await expect(page.getByRole("button", { name: "Phê duyệt" })).toHaveCount(0); // not in allowedActions
    // the technical block is folded away but reachable
    await page.getByText("Thông tin kỹ thuật").click();
    await expect(page.getByText(created.body.id)).toBeVisible();
    await withdraw.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Hủy bỏ" }).click();
    await expect(page.getByTestId("status-banner")).toContainText("Chờ duyệt"); // nothing happened
  });
});

test("IT: cancelling a submitted ticket asks for confirmation first", async ({ browser }) => {
  const requester = await apiLogin("requester2");
  const created = await requester.create("ticket", { title: `Hủy thử ${RUN}`, description: "Phiếu dùng để thử xác nhận hủy.", categoryCode: "NETWORK", priority: "LOW" });
  await requester.transition("ticket", created.body.id, "submit", 0);
  await requester.dispose();
  await as(browser, "requester2", async (page) => {
    await page.goto(`/tickets/${created.body.id}`);
    await page.getByRole("button", { name: "Hủy yêu cầu" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Hủy bỏ" }).click();
    await expect(page.getByTestId("status-banner")).toContainText("Đã gửi");
    await page.getByRole("button", { name: "Hủy yêu cầu" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Hủy yêu cầu" }).click();
    await expect(page.getByTestId("status-banner")).toContainText("Đã hủy");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
});

test("a failed client-side validation moves focus to the first invalid field", async ({ browser }) => {
  await as(browser, "requester1", async (page) => {
    await page.goto("/tickets/new");
    await page.getByRole("button", { name: "Lưu nháp" }).click();
    await expect(page.getByLabel("Tiêu đề")).toBeFocused();
  });
});
