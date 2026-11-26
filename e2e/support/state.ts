// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";
import type { Role } from "./api";

/** Browser storage state of a signed-in role (cookies only; git-ignored under .local). */
export const statePath = (role: Role) => fileURLToPath(new URL(`../../.local/auth/${role}.json`, import.meta.url));
