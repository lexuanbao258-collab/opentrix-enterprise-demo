// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, credentials } from "../support/api";
import { shot } from "../support/shots";

async function signIn(page: Page) {
  const { username, password } = credentials("requester2");
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
}

test("an ended session shows the sign-in dialog and signing in again returns to the app", async ({ page }) => {
  await signIn(page);
  // The server forgets the session (idle timeout, revoked token, restart). Here: POST /bff/logout without the identity provider.
  const session = await (await page.request.get("/bff/session")).json();
  await page.request.post("/bff/logout", { headers: { Origin: BASE_URL, "X-CSRF-Token": session.csrfToken } });
  await page.getByRole("link", { name: "Yêu cầu của tôi" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Phiên đăng nhập đã hết hạn" });
  await expect(dialog).toBeVisible();
  await shot(page, "09-session-expired");
  await dialog.getByRole("button", { name: "Đăng nhập" }).click();
  // The identity provider session is still alive, so single sign-on brings the user back.
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
});

test("logout ends the BFF and identity provider sessions", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page.locator("#username")).toBeVisible();
  expect((await (await page.request.get("/bff/session")).json()).authenticated).toBe(false);
  // Opening the app again requires credentials: no silent single sign-on.
  await page.goto("/my-requests");
  await expect(page.locator("#username")).toBeVisible();
});
