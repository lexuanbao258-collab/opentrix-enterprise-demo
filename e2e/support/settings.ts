// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0

const project = process.env.ESM_STACK_PROJECT ?? "opentrix-esm";
if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error("Invalid ESM_STACK_PROJECT");
const defaultProject = project === "opentrix-esm";
const localRoot = new URL(defaultProject ? "../../.local/" : `../../.local/${project}/`, import.meta.url);
export const localFile = (name: string) => new URL(name, localRoot);
export const evidenceFile = (name: string) => (
  defaultProject ? new URL(`../../docs/evidence/${name}`, import.meta.url) : localFile(name)
);

export const BASE_URL = new URL(
  process.env.E2E_BASE_URL ?? process.env.ESM_BFF_URL ?? process.env.ESM_PUBLIC_ORIGIN
    ?? `http://localhost:${process.env.ESM_PORT ?? 5174}`,
).origin;
export const PLATFORM_URL = new URL(
  process.env.E2E_PLATFORM_URL ?? process.env.PLATFORM_API_URL
    ?? `https://localhost:${process.env.ESM_PLATFORM_HTTPS_PORT ?? 8443}`,
).origin;
