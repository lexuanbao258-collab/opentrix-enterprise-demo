// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "@playwright/test";
import { shot } from "../support/shots";
import { statePath } from "../support/state";

const CODE = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 14);

test.describe("administrator manages service categories", () => {
  test.use({ storageState: statePath("admin") });

  test("create, edit and delete a category through the UI", async ({ page }) => {
    await page.goto("/categories");
    await expect(page.getByRole("heading", { name: "Danh mục dịch vụ" })).toBeVisible();
    await page.getByRole("button", { name: "Thêm danh mục" }).click();

    // an invalid code is refused before any request
    await page.getByLabel("Mã", { exact: true }).fill("x");
    await page.getByLabel("Tên danh mục").fill("Danh mục kiểm thử");
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(page.getByText(/Chỉ dùng chữ in hoa/)).toBeVisible();

    await page.getByLabel("Mã", { exact: true }).fill(CODE);
    await page.getByLabel("Mô tả").fill("Tạo bởi kiểm thử E2E");
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(page.getByText("Đã lưu danh mục.")).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: CODE });
    await expect(row).toContainText("Danh mục kiểm thử");
    await shot(page, "08-admin-categories");

    await page.getByRole("button", { name: `Chỉnh sửa ${CODE}` }).click();
    await expect(page.getByLabel("Mã", { exact: true })).toBeDisabled();
    await page.getByLabel("Tên danh mục").fill("Danh mục kiểm thử (sửa)");
    await page.getByLabel("Đang sử dụng").uncheck();
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(row).toContainText("Danh mục kiểm thử (sửa)");
    await expect(row).toContainText("Ngừng sử dụng");

    await page.getByRole("button", { name: `Xóa ${CODE}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Xóa" }).click();
    await expect(page.getByText("Đã xóa danh mục.")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: CODE })).toHaveCount(0);
  });

  test("categories written under manifest 1.0.0 are listed", async ({ page }) => {
    await page.goto("/categories");
    await expect(page.getByRole("row").filter({ hasText: "HARDWARE" })).toBeVisible();
  });
});

test.describe("other roles only read categories", () => {
  for (const role of ["requester1", "agent"] as const) {
    test(`${role}: no management controls`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: statePath(role), locale: "vi-VN" });
      const page = await context.newPage();
      await page.goto("/categories");
      await expect(page.getByRole("row").filter({ hasText: "NETWORK" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Thêm danh mục" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Chỉnh sửa / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Xóa / })).toHaveCount(0);
      await context.close();
    });
  }
});
