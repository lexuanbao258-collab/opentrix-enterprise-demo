// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createOidc } from "./oidc.js";
import { SessionStore } from "./sessions.js";

const config = loadConfig();
const sessions = new SessionStore(config.sessionIdleMs, config.sessionMaxMs);
setInterval(() => sessions.sweep(), 60_000).unref();
const app = createApp({ config, oidc: createOidc(config), sessions });
app.listen(config.port, config.host, () => {
  console.log(`ESM BFF listening on ${config.host}:${config.port} (${config.publicOrigin})`);
});
