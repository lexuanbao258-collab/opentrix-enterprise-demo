// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync } from "node:fs";
import { test as setup, expect } from "@playwright/test";
import { apiLogin, credentials, type Role } from "../support/api";
import { statePath } from "../support/state";

mkdirSync(new URL("../../.local/auth", import.meta.url), { recursive: true });

for (const role of ["requester1", "requester2", "agent", "admin"] as Role[]) {
  setup(`sign in as ${role} through Keycloak`, async ({ page }) => {
    const { username, password } = credentials(role);
    await page.goto("/");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.locator("#kc-login").click();
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    await page.context().storageState({ path: statePath(role) });
  });
}

// A fresh installation has no categories. Create the ones the flows need, only when missing (no duplicates on a seeded stack).
setup("ensure the service categories used by the flows exist", async () => {
  const admin = await apiLogin("admin");
  const page = await admin.get("/entities/category/records?limit=100");
  const have = new Set(page.body.items.map((item: { data: { code: string } }) => item.data.code));
  const wanted = [
    { code: "NETWORK", name: "Mạng và VPN", description: "Sự cố kết nối mạng, VPN, Wi-Fi", active: true },
    { code: "HARDWARE", name: "Thiết bị phần cứng", description: "Máy tính, màn hình, máy in", active: true },
    { code: "ACCOUNT", name: "Tài khoản và quyền truy cập", active: true },
  ];
  for (const data of wanted.filter((item) => !have.has(item.code))) {
    expect((await admin.create("category", data)).status).toBe(201);
  }
  await admin.dispose();
});
