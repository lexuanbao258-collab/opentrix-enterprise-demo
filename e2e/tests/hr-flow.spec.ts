// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { localFile } from "../support/settings";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiLogin, HR, type Role } from "../support/api";
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
const SECRET = `Lý do riêng tư ${RUN}`;
const idOf = (url: string) => /\/hr\/requests\/([0-9a-f-]{36})/.exec(url)?.[1] ?? "";

/** Ids written for the restart check (see hr-restart.spec.ts). */
const IDS = localFile("hr-ids.json");
const ids: Record<string, { id: string; state: string }> = {};
const remember = (key: string, id: string, state: string) => {
  ids[key] = { id, state };
  mkdirSync(localFile("."), { recursive: true });
  writeFileSync(IDS, JSON.stringify(ids, null, 2));
};

async function fillForm(page: Page, reason: string, days = "3") {
  await page.getByLabel("Loại nghỉ").selectOption("ANNUAL");
  await page.getByLabel("Ngày bắt đầu").fill("2026-12-21");
  await page.getByLabel("Số ngày nghỉ").fill(days);
  await page.getByLabel("Lý do", { exact: true }).fill(reason);
}

test.describe.serial("HR Leave: employee, manager approval, auditor", () => {
  let employeeRequest = "";
  let selfRequest = "";
  let rejectedRequest = "";

  test("employee signs in, creates a draft, edits it and submits it", async ({ browser }) => {
    await as(browser, "employee1", async (page) => {
      await page.goto("/");
      // HR-only user lands on HR Leave and sees no IT navigation
      await expect(page).toHaveURL(/\/hr$/);
      await expect(page.getByRole("heading", { level: 1, name: "Tổng quan nghỉ phép" })).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
      await expect(nav.getByRole("link", { name: "Quản lý phiếu" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Chờ tôi duyệt" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Kiểm toán nghỉ phép" })).toHaveCount(0);

      await nav.getByRole("link", { name: "Tạo đơn nghỉ phép" }).click();
      await expect(page.getByRole("heading", { name: "Tạo đơn nghỉ phép" })).toBeVisible();
      await page.getByLabel("Số ngày nghỉ").fill("31");
      await page.getByRole("button", { name: "Gửi duyệt" }).click();
      await expect(page.getByText("Bắt buộc nhập").first()).toBeVisible(); // client-side validation: empty date and reason
      await expect(page.locator(".field-error", { hasText: "Nhập số nguyên từ 1 đến 30" })).toBeVisible();

      await fillForm(page, SECRET, "2");
      await shot(page, "hr-01-employee-create-form");
      await page.getByRole("button", { name: "Lưu nháp" }).click();
      await expect(page).toHaveURL(/\/hr\/requests\/[0-9a-f-]{36}$/);
      employeeRequest = idOf(page.url());
      await expect(page.getByText("Đã lưu đơn nháp.")).toBeVisible();
      await expect(page.locator("[data-state='DRAFT']")).toBeVisible();

      // edit the draft (version check), then submit from the detail page
      await page.getByRole("link", { name: "Chỉnh sửa" }).click();
      await page.getByLabel("Số ngày nghỉ").fill("3");
      await page.getByRole("button", { name: "Lưu nháp" }).click();
      await expect(page.getByText("Đã cập nhật đơn.")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("3 ngày");
      await page.getByRole("button", { name: "Gửi duyệt" }).click();
      await expect(page.locator("[data-state='PENDING']")).toBeVisible();
      await expect(page.getByTestId("leave-reason")).toHaveText(SECRET);
      // locked after submit: no edit or delete, employee may only withdraw
      await expect(page.getByRole("link", { name: "Chỉnh sửa" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Xóa" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Rút đơn" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Phê duyệt" })).toHaveCount(0);
      await shot(page, "hr-02-employee-submitted");
    });
    remember("employeeRequest", employeeRequest, "PENDING");
  });

  test("employee can delete a draft and discard another one", async ({ browser }) => {
    await as(browser, "employee1", async (page) => {
      await page.goto("/hr/requests/new");
      await fillForm(page, `Bản nháp để xóa ${RUN}`);
      await page.getByRole("button", { name: "Lưu nháp" }).click();
      await expect(page).toHaveURL(/\/hr\/requests\/[0-9a-f-]{36}$/);
      const id = idOf(page.url());
      await page.getByRole("button", { name: "Xóa" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Xóa" }).click();
      await expect(page).toHaveURL(/\/hr\/my-requests$/);
      await page.goto(`/hr/requests/${id}`);
      await expect(page.getByText("Không tìm thấy đơn")).toBeVisible();

      await page.goto("/hr/requests/new");
      await fillForm(page, `Bản nháp để hủy ${RUN}`);
      await page.getByRole("button", { name: "Lưu nháp" }).click();
      await page.getByRole("button", { name: "Hủy bản nháp" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Hủy bản nháp" }).click();
      await expect(page.locator("[data-state='CANCELLED']")).toBeVisible();
    });
  });

  test("a creator who is also a manager cannot self-approve or self-reject (UI and API)", async ({ browser }) => {
    await as(browser, "dual", async (page) => {
      await page.goto("/hr/requests/new");
      await fillForm(page, `Tự duyệt ${RUN}`);
      await page.getByRole("button", { name: "Gửi duyệt" }).click();
      await expect(page.locator("[data-state='PENDING']")).toBeVisible();
      selfRequest = idOf(page.url());
      await expect(page.getByRole("button", { name: "Phê duyệt" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Từ chối" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Rút đơn" })).toBeVisible();
      await expect(page.getByTestId("self-approval-note")).toBeVisible();
      await shot(page, "hr-03-self-approval-blocked");

      // the queue lists the request, flagged as the caller's own
      await page.goto("/hr/approvals");
      await page.getByRole("searchbox").fill(`Tự duyệt ${RUN}`);
      const row = page.locator("tr", { has: page.locator(`a[href="/hr/requests/${selfRequest}"]`) });
      await expect(row).toBeVisible();
      await expect(row).toContainText("Bạn");

      // direct API: the Platform refuses, and the record is unchanged
      const api = (await apiLogin("dual")).forApp(HR);
      for (const action of ["approve", "reject"]) {
        const denied = await api.transition("leaveRequest", selfRequest, action, 1);
        expect(denied.status, action).toBe(403);
        expect(denied.body.code).toBe("FORBIDDEN");
      }
      const after = await api.get(`/entities/leaveRequest/records/${selfRequest}`);
      expect(after.body).toMatchObject({ state: "PENDING", version: 1 });
      await api.dispose();
    });
    remember("selfRequest", selfRequest, "PENDING");
  });

  test("another manager sees the queue and approves the employee's request", async ({ browser }) => {
    await as(browser, "manager", async (page) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/hr$/);
      await page.getByRole("link", { name: "Chờ tôi duyệt" }).click();
      await page.getByRole("searchbox").fill(SECRET);
      const link = page.locator(`a[href="/hr/requests/${employeeRequest}"]`);
      await expect(link).toBeVisible();
      await shot(page, "hr-04-manager-approval-queue");
      await link.click();
      await expect(page.getByTestId("leave-reason")).toHaveText(SECRET);
      await expect(page.getByTestId("self-approval-note")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Rút đơn" })).toHaveCount(0); // withdraw belongs to the employee
      await expect(page.getByRole("link", { name: "Chỉnh sửa" })).toHaveCount(0);
      await page.getByRole("button", { name: "Phê duyệt" }).click();
      await expect(page.locator("[data-state='APPROVED']")).toBeVisible();
      await expect(page.getByText("Đã thực hiện: Phê duyệt")).toBeVisible();
      await expect(page.getByRole("button", { name: "Phê duyệt" })).toHaveCount(0);
      await expect(page.getByText("Đơn đã gửi nên không thể chỉnh sửa hoặc xóa.")).toBeVisible();
      await shot(page, "hr-05-manager-approved");
    });
    remember("employeeRequest", employeeRequest, "APPROVED");
  });

  test("the manager rejects another request after confirming; the employee sees the real status", async ({ browser }) => {
    await as(browser, "employee2", async (page) => {
      await page.goto("/hr/requests/new");
      await fillForm(page, `Sẽ bị từ chối ${RUN}`);
      await page.getByRole("button", { name: "Gửi duyệt" }).click();
      await expect(page.locator("[data-state='PENDING']")).toBeVisible();
      rejectedRequest = idOf(page.url());
    });
    await as(browser, "manager", async (page) => {
      await page.goto(`/hr/requests/${rejectedRequest}`);
      await page.getByRole("button", { name: "Từ chối" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("không thể mở lại");
      await shot(page, "hr-06-manager-reject-confirm");
      await dialog.getByRole("button", { name: "Từ chối" }).click();
      await expect(page.locator("[data-state='REJECTED']")).toBeVisible();
    });
    await as(browser, "employee2", async (page) => {
      await page.goto("/hr/my-requests");
      await page.getByRole("searchbox").fill(`Sẽ bị từ chối ${RUN}`);
      const row = page.locator("tr", { has: page.locator(`a[href="/hr/requests/${rejectedRequest}"]`) });
      await expect(row.locator("[data-state='REJECTED']")).toBeVisible();
      await expect(page.getByRole("button", { name: "Phê duyệt" })).toHaveCount(0);
    });
    remember("rejectedRequest", rejectedRequest, "REJECTED");
  });

  test("the employee sees the actual approved status, history and dashboard", async ({ browser }) => {
    await as(browser, "employee1", async (page) => {
      await page.goto("/hr/my-requests");
      await page.getByRole("searchbox").fill(SECRET);
      const row = page.locator("tr", { has: page.locator(`a[href="/hr/requests/${employeeRequest}"]`) });
      await expect(row.locator("[data-state='APPROVED']")).toBeVisible();
      await shot(page, "hr-07-employee-my-requests");
      await page.goto(`/hr/requests/${employeeRequest}`);
      await expect(page.locator("[data-state='APPROVED']")).toBeVisible();
      const history = page.getByTestId("history-item");
      await expect(history).toHaveCount(3); // workflow history: create, submit, approve (field edits appear only in the audit trail)
      await expect(history.last()).toContainText("Phê duyệt");
      await expect(history.last()).toContainText("Đã duyệt");
      await expect(page.getByRole("link", { name: "Chỉnh sửa" })).toHaveCount(0);
      await shot(page, "hr-08-employee-approved-history");
      await page.goto("/hr");
      await expect(page.getByTestId("scope-note")).toContainText("Dựa trên toàn bộ");
      await expect(page.getByTestId("tile-APPROVED")).toBeVisible();
    });
  });

  test("the auditor sees authorized audit events with the reason redacted", async ({ browser }) => {
    await as(browser, "auditor", async (page) => {
      await page.goto("/hr");
      const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
      await expect(nav.getByRole("link", { name: "Tạo đơn nghỉ phép" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Chờ tôi duyệt" })).toHaveCount(0);
      await nav.getByRole("link", { name: "Kiểm toán nghỉ phép" }).click();
      await page.getByRole("searchbox").fill(employeeRequest);
      await expect(page.getByRole("row")).toHaveCount(5); // header + create, update, submit, approve
      await expect(page.getByText("Phê duyệt: Chờ duyệt → Đã duyệt")).toBeVisible();
      const text = await page.locator("main").innerText();
      expect(text).not.toContain(SECRET);
      await shot(page, "hr-09-auditor-audit");
    });
    const auditor = (await apiLogin("auditor")).forApp(HR);
    const audit = await auditor.get(`/entities/leaveRequest/audit?recordId=${employeeRequest}&limit=50`);
    expect(audit.status).toBe(200);
    expect(audit.body.items.length).toBe(4);
    expect(JSON.stringify(audit.body)).not.toContain(SECRET);
    for (const item of audit.body.items) for (const side of [item.before, item.after]) if (side) expect(side.reason).not.toBe(SECRET);
    await auditor.dispose();
  });

  test("a user holding roles in both applications sees both and can switch", async ({ browser }) => {
    await as(browser, "dual", async (page) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible(); // IT dashboard at /
      const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
      await expect(nav.getByRole("heading", { name: "Hỗ trợ CNTT" })).toBeVisible();
      await expect(nav.getByRole("heading", { name: "Nghỉ phép" })).toBeVisible();
      await shot(page, "hr-10-dual-navigation");
      await nav.getByRole("link", { name: "Chờ tôi duyệt" }).click();
      await expect(page).toHaveURL(/\/hr\/approvals$/);
      await expect(page.getByRole("heading", { level: 1, name: "Chờ tôi duyệt" })).toBeVisible();
      await nav.getByRole("link", { name: "Yêu cầu của tôi" }).click();
      await expect(page).toHaveURL(/\/my-requests$/);
      await expect(page.getByRole("heading", { level: 1, name: "Yêu cầu của tôi" })).toBeVisible();
      // "Đơn của tôi" for an employee who can also read everything lists only the caller's own requests
      await nav.getByRole("link", { name: "Đơn của tôi" }).click();
      await page.getByRole("searchbox").fill(`Tự duyệt ${RUN}`);
      await expect(page.locator(`a[href="/hr/requests/${selfRequest}"]`)).toBeVisible();
      await page.getByRole("searchbox").fill(SECRET);
      await expect(page.getByText("Chưa có đơn nào phù hợp.")).toBeVisible(); // employee1's request is not "mine"
    });
  });

  test("a manager who is not an employee cannot create requests; unauthorized routes are refused", async ({ browser }) => {
    await as(browser, "manager", async (page) => {
      const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
      await page.goto("/hr");
      await expect(nav.getByRole("link", { name: "Tạo đơn nghỉ phép" })).toHaveCount(0);
      await page.goto("/hr/requests/new");
      await expect(page.getByText("Không có quyền truy cập")).toBeVisible();
      await page.goto("/hr/audit");
      await expect(page.getByText("Không có quyền truy cập")).toBeVisible();
      await page.goto("/tickets");
      await expect(page.getByText("Không có quyền truy cập")).toBeVisible();
    });
    await as(browser, "employee1", async (page) => {
      await page.goto("/hr/approvals");
      await expect(page.getByText("Không có quyền truy cập")).toBeVisible();
      await page.goto("/hr/requests");
      await expect(page.getByText("Không có quyền truy cập")).toBeVisible();
      await page.goto("/hr/audit");
      await expect(page.getByText("Không có quyền truy cập")).toBeVisible();
      await page.goto(`/hr/requests/${selfRequest}`); // another employee's request: hidden, not merely disabled
      await expect(page.getByText("Không tìm thấy đơn")).toBeVisible();
    });
    await as(browser, "requester1", async (page) => {
      await page.goto("/hr");
      await expect(page.getByText("Không có quyền truy cập")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Đơn của tôi" })).toHaveCount(0);
      await shot(page, "hr-11-it-only-user-denied-hr");
    });
  });
});
