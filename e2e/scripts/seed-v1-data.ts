// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { localFile } from "../support/settings";
// Writes category records while the stack runs it-helpdesk 1.0.0, so the upgrade test has real data to preserve.
// Usage: tsx scripts/seed-v1-data.ts  (BFF must be running against the stack)
import { writeFileSync } from "node:fs";
import { apiLogin } from "../support/api.ts";

const CATEGORIES = [
  { code: "NETWORK", name: "Mạng và VPN", description: "Sự cố kết nối mạng, VPN, Wi-Fi", active: true },
  { code: "HARDWARE", name: "Thiết bị phần cứng", description: "Máy tính, màn hình, máy in", active: true },
  { code: "ACCOUNT", name: "Tài khoản và quyền truy cập", active: true },
  { code: "LEGACY", name: "Danh mục cũ", description: "Không còn sử dụng", active: false },
];

const admin = await apiLogin("admin");
const app = await admin.get("");
console.log("app version before upgrade:", app.body.version, "roles:", app.body.callerRoles);
const created: Record<string, { id: string; version: number }> = {};
for (const data of CATEGORIES) {
  const reply = await admin.create("category", data);
  if (reply.status !== 201) throw new Error(`seed failed ${data.code}: ${reply.status} ${JSON.stringify(reply.body)}`);
  created[data.code] = { id: reply.body.id, version: reply.body.version };
}
// A second revision so version numbers are visible after the upgrade.
const net = created.NETWORK!;
const updated = await admin.put(`/entities/category/records/${net.id}`, {
  expectedVersion: net.version,
  data: { ...CATEGORIES[0], description: "Sự cố kết nối mạng, VPN, Wi-Fi (đã cập nhật)" },
});
created.NETWORK = { id: net.id, version: updated.body.version };
writeFileSync(localFile("seed-v1.json"), JSON.stringify(created, null, 2));
console.log("seeded", Object.keys(created).length, "categories:", JSON.stringify(created));
await admin.dispose();
