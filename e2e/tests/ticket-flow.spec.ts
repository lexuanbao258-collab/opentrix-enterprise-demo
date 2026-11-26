// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Browser, type Page } from "@playwright/test";
import { type Role } from "../support/api";
import { shot } from "../support/shots";
import { statePath } from "../support/state";

async function as<T>(browser: Browser, role: Role, body: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: statePath(role), locale: "vi-VN" });
  const page = await context.newPage();
  try {
    return await body(page);
  } finally {
    await context.close();
  }
}

const RUN = Date.now().toString(36);
const TITLE = `Không kết nối được VPN ${RUN}`;

test.describe.serial("IT Helpdesk: request, handle, confirm, audit", () => {
  let ticketPath = "";

  test("requester creates and submits a ticket", async ({ browser }) => {
    await as(browser, "requester1", async (page) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Quản lý phiếu" })).toHaveCount(0);
      await page.getByRole("link", { name: "Tạo yêu cầu" }).first().click();
      await expect(page.getByRole("heading", { name: "Tạo yêu cầu hỗ trợ" })).toBeVisible();

      // client-side validation mirrors the manifest and blocks an empty submit
      await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
      await expect(page.getByText("Bắt buộc nhập").first()).toBeVisible();

      await page.getByLabel("Tiêu đề").fill(TITLE);
      await page.getByLabel("Danh mục").selectOption({ label: "Mạng và VPN" });
      await page.getByLabel("Mức ưu tiên").selectOption("HIGH");
      await page.getByLabel("Mô tả chi tiết").fill("Sau khi cập nhật hệ điều hành, VPN báo lỗi xác thực. Chưa thể làm việc từ xa.");
      await shot(page, "01-requester-create-form");
      await page.getByRole("button", { name: "Gửi yêu cầu" }).click();

      await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
      ticketPath = new URL(page.url()).pathname;
      await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
      await expect(page.getByText("Đã gửi yêu cầu.")).toBeVisible();
      await expect(page.locator("[data-state='SUBMITTED']")).toBeVisible();
      // locked after submit: no edit/delete, and only the requester's own actions are offered
      await expect(page.getByRole("link", { name: "Chỉnh sửa" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Xóa" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Hủy yêu cầu" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Tiếp nhận xử lý" })).toHaveCount(0);
      await shot(page, "02-requester-ticket-submitted");
    });
  });

  test("requester sees the ticket in My requests and on the dashboard", async ({ browser }) => {
    await as(browser, "requester1", async (page) => {
      await page.goto("/my-requests");
      await expect(page.getByRole("link", { name: TITLE })).toBeVisible();
      await shot(page, "03-requester-my-requests");
      await page.goto("/");
      await expect(page.getByTestId("scope-note")).toContainText("Dựa trên toàn bộ");
      await expect(page.getByRole("link", { name: TITLE })).toBeVisible();
    });
  });

  test("agent finds the ticket, takes it and resolves it", async ({ browser }) => {
    await as(browser, "agent", async (page) => {
      await page.goto("/tickets");
      await page.getByRole("searchbox").fill(RUN);
      await expect(page.getByRole("link", { name: TITLE })).toBeVisible();
      await shot(page, "04-agent-queue");
      await page.getByRole("link", { name: TITLE }).click();
      await expect(page).toHaveURL(ticketPath);

      // the agent never owns requester actions
      await expect(page.getByRole("button", { name: "Hủy yêu cầu" })).toHaveCount(0);
      await page.getByRole("button", { name: "Tiếp nhận xử lý" }).click();
      await expect(page.locator("[data-state='IN_PROGRESS']")).toBeVisible();
      await expect(page.getByRole("button", { name: "Tiếp nhận xử lý" })).toHaveCount(0);
      await page.getByRole("button", { name: "Đánh dấu đã xử lý" }).click();
      await expect(page.locator("[data-state='RESOLVED']")).toBeVisible();
      // resolved: confirming belongs to the requester
      await expect(page.getByRole("button", { name: "Xác nhận đã xử lý" })).toHaveCount(0);
      await expect(page.getByTestId("history-item")).toHaveCount(4);
      await shot(page, "05-agent-resolved");
    });
  });

  test("requester confirms the resolution and the ticket closes", async ({ browser }) => {
    await as(browser, "requester1", async (page) => {
      await page.goto(ticketPath);
      await expect(page.locator("[data-state='RESOLVED']")).toBeVisible();
      await expect(page.getByRole("button", { name: "Yêu cầu xử lý lại" })).toBeVisible();
      await page.getByRole("button", { name: "Xác nhận đã xử lý" }).click();
      await expect(page.locator("[data-state='CLOSED']")).toBeVisible();
      await expect(page.getByText("Không có thao tác nào dành cho bạn").or(page.getByText("Phiếu đã gửi nên không thể"))).toBeVisible();
      const items = page.getByTestId("history-item");
      await expect(items).toHaveCount(5);
      await expect(items.nth(0)).toContainText("Nháp");
      await expect(items.nth(1)).toContainText("Đã gửi");
      await expect(items.nth(2)).toContainText("Đang xử lý");
      await expect(items.nth(3)).toContainText("Đã xử lý");
      await expect(items.nth(4)).toContainText("Đã đóng");
      await shot(page, "06-requester-closed-history");
    });
  });

  test("administrator reads the audit trail with sensitive values redacted", async ({ browser }) => {
    await as(browser, "admin", async (page) => {
      await page.goto("/audit");
      await page.getByRole("searchbox").fill(ticketPath.split("/").pop()!);
      await expect(page.getByRole("cell", { name: /Chuyển trạng thái/ }).first()).toBeVisible();
      await expect(page.locator("tbody tr")).toHaveCount(5);
      await expect(page.locator("tbody")).toContainText("[REDACTED]");
      await expect(page.locator("tbody")).not.toContainText("xác thực");
      await shot(page, "07-admin-audit");
    });
  });

  test("draft can be edited and deleted by its owner", async ({ browser }) => {
    await as(browser, "requester1", async (page) => {
      await page.goto("/tickets/new");
      await page.getByLabel("Tiêu đề").fill(`Bản nháp ${RUN}`);
      await page.getByLabel("Danh mục").selectOption({ label: "Thiết bị phần cứng" });
      await page.getByLabel("Mô tả chi tiết").fill("Bàn phím bị liệt phím.");
      await page.getByRole("button", { name: "Lưu nháp" }).click();
      await expect(page.locator("[data-state='DRAFT']")).toBeVisible();
      await page.getByRole("link", { name: "Chỉnh sửa" }).click();
      await page.getByLabel("Tiêu đề").fill(`Bản nháp đã sửa ${RUN}`);
      await page.getByRole("button", { name: "Lưu nháp" }).click();
      await expect(page.getByRole("heading", { level: 1, name: `Bản nháp đã sửa ${RUN}` })).toBeVisible();
      await expect(page.getByText("Phiên bản").locator("xpath=following-sibling::dd")).toHaveText("1");
      await page.getByRole("button", { name: "Xóa", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Xóa" }).click();
      await expect(page).toHaveURL(/\/my-requests$/);
      await expect(page.getByRole("link", { name: `Bản nháp đã sửa ${RUN}` })).toHaveCount(0);
    });
  });
});
