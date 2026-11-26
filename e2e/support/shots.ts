// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const DIR = fileURLToPath(new URL("../../docs/evidence/screenshots/", import.meta.url));

/** Evidence screenshot of a real flow. Pages never contain credentials: login forms are not captured. */
export async function shot(page: Page, name: string, fullPage = false) {
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: `${DIR}${name}.png`, fullPage });
}
