// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
// Representative screenshots of the demo dataset (see seed-demo.ts), desktop and mobile.
// Usage: tsx scripts/shots-m62.ts <before|after>   (BFF of the demo stack running, auth states from the setup project)
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, devices } from "@playwright/test";
import { BASE_URL, localFile } from "../support/settings.ts";
import { statePath } from "../support/state.ts";
import type { Role } from "../support/api.ts";

const phase = process.argv[2] ?? "after";
const ids: Record<string, string> = JSON.parse(readFileSync(localFile("demo-ids.json"), "utf8"));
const dir = new URL(`../../docs/evidence/m62/${phase}/`, import.meta.url);
mkdirSync(dir, { recursive: true });

const PAGES: { role: Role; path: string; name: string }[] = [
  { role: "requester1", path: "/", name: "it-requester-dashboard" },
  { role: "requester1", path: "/my-requests", name: "it-requester-my-requests" },
  { role: "requester1", path: "/tickets/new", name: "it-requester-new" },
  { role: "requester1", path: `/tickets/${ids.t01}`, name: "it-requester-detail-submitted" },
  { role: "requester2", path: `/tickets/${ids.t07}`, name: "it-requester-detail-resolved" },
  { role: "agent", path: "/", name: "it-agent-dashboard" },
  { role: "agent", path: "/tickets", name: "it-agent-queue" },
  { role: "agent", path: `/tickets/${ids.t05}`, name: "it-agent-detail-in-progress" },
  { role: "admin", path: "/categories", name: "it-admin-categories" },
  { role: "admin", path: "/audit", name: "it-admin-audit" },
  { role: "employee1", path: "/hr", name: "hr-employee-dashboard" },
  { role: "employee1", path: "/hr/my-requests", name: "hr-employee-my-requests" },
  { role: "employee1", path: "/hr/requests/new", name: "hr-employee-new" },
  { role: "employee1", path: `/hr/requests/${ids.l04}`, name: "hr-employee-detail-approved" },
  { role: "manager", path: "/hr", name: "hr-manager-dashboard" },
  { role: "manager", path: "/hr/approvals", name: "hr-manager-approvals" },
  { role: "manager", path: `/hr/requests/${ids.l01}`, name: "hr-manager-detail-pending" },
  { role: "auditor", path: "/hr/audit", name: "hr-auditor-audit" },
  { role: "dual", path: "/", name: "dual-it-dashboard" },
  { role: "dual", path: `/hr/requests/${ids.l03}`, name: "dual-hr-self-approval" },
];

const browser = await chromium.launch();
for (const [label, options] of [["desktop", { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }], ["mobile", devices["Pixel 7"]]] as const) {
  for (const entry of PAGES) {
    const context = await browser.newContext({ ...options, storageState: statePath(entry.role), locale: "vi-VN", baseURL: BASE_URL });
    const page = await context.newPage();
    await page.goto(entry.path);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: new URL(`${label}-${entry.name}.png`, dir).pathname.replace(/^\/([A-Za-z]:)/, "$1"), fullPage: true });
    if (label === "mobile" && entry.name === "dual-it-dashboard") {
      await page.getByRole("button", { name: "Mở menu" }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: new URL(`${label}-dual-menu-open.png`, dir).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
    }
    await context.close();
  }
}
await browser.close();
console.log(`screenshots written to docs/evidence/m62/${phase}`);
