// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

import { evidenceFile } from "./settings";

const DIR = fileURLToPath(evidenceFile("screenshots/"));

/** Evidence screenshot of a real flow. Pages never contain credentials: login forms are not captured. */
export async function shot(page: Page, name: string, fullPage = false) {
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: `${DIR}${name}.png`, fullPage });
}
