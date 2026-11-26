// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
// Looks for the REAL secret values of this checkout (from git-ignored .local/*.env) and for generic secret shapes in
// everything that could be published: git-tracked files, build output and evidence. Exit 1 on any hit.
//   node scripts/scan-secrets.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const values = [];
for (const file of [".local/esm.env", ".local/platform.env"]) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.{8,})$/.exec(line);
    if (match && /SECRET|PASSWORD/.test(match[1])) values.push({ name: match[1], value: match[2] });
  }
}

const shapes = [
  { name: "JWT", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "bearer token literal", pattern: /Bearer\s+[A-Za-z0-9._-]{30,}/ },
  { name: "AWS key", pattern: /AKIA[0-9A-Z]{16}/ },
];

const files = new Set(
  execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root }).toString().split("\n").filter(Boolean),
);
for (const dir of ["web/dist", "bff/dist", "docs/evidence"]) {
  const base = join(root, dir);
  if (!existsSync(base)) continue;
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.add(relative(root, full).replaceAll("\\", "/"));
    }
  };
  walk(base);
}

const hits = [];
let scanned = 0;
for (const file of files) {
  if (/\.(png|jpe?g|woff2?|ico)$/i.test(file) || file.endsWith("package-lock.json")) continue;
  const full = join(root, file);
  if (!existsSync(full) || statSync(full).size > 5_000_000) continue;
  const text = readFileSync(full, "utf8");
  scanned++;
  for (const secret of values) if (text.includes(secret.value)) hits.push(`${file}: contains the value of ${secret.name}`);
  for (const shape of shapes) if (shape.pattern.test(text)) hits.push(`${file}: looks like a ${shape.name}`);
}

console.log(`scanned ${scanned} files against ${values.length} real secret values and ${shapes.length} patterns`);
if (hits.length) {
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log("SECRET_SCAN_PASS");
