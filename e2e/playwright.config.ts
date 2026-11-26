// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.ESM_PUBLIC_ORIGIN ?? "http://localhost:5174";

/**
 * Runs against a REAL stack: PostgreSQL + Keycloak + Platform backend + the ESM BFF serving the built SPA.
 * Nothing is mocked. Start the stack first (see docs/DEVELOPMENT.md).
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "../docs/evidence/e2e-results.json" }]],
  use: { baseURL, trace: "off", screenshot: "off", locale: "vi-VN" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "desktop",
      testIgnore: [/auth\.setup\.ts/, /layout\.spec\.ts/],
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "layout-desktop",
      testMatch: /layout\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "layout-mobile",
      testMatch: /layout\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"] },
    },
  ],
});
