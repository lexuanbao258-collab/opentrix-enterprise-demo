// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0

export interface Config {
  port: number;
  host: string;
  publicOrigin: string;
  oidcIssuer: string;
  oidcRedirectUri: string;
  oidcClientId: string;
  oidcClientSecret: string;
  platformApiUrl: string;
  cookieSecure: boolean;
  sessionIdleMs: number;
  sessionMaxMs: number;
  staticDir: string | null;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`Missing environment variable ${name}`);
  return value.trim();
}

function origin(value: string, name: string): string {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash || url.username) throw new Error(`${name} must be an origin`);
  return url.origin;
}

/** Reads the BFF configuration. Secrets only come from the environment, never from files in Git. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicOrigin = origin(required(env, "ESM_PUBLIC_ORIGIN"), "ESM_PUBLIC_ORIGIN");
  const redirect = new URL(env.OIDC_REDIRECT_URI?.trim() || `${publicOrigin}/bff/callback`);
  const browser = new URL(publicOrigin);
  if (redirect.pathname !== "/bff/callback" || redirect.search || redirect.hash || redirect.username || redirect.password
      || redirect.hostname !== browser.hostname || redirect.protocol !== browser.protocol) {
    throw new Error("OIDC_REDIRECT_URI must target /bff/callback on the BFF's host and scheme");
  }
  const platformApiUrl = origin(required(env, "PLATFORM_API_URL"), "PLATFORM_API_URL");
  const secure = env.ESM_COOKIE_SECURE ? env.ESM_COOKIE_SECURE === "true" : publicOrigin.startsWith("https:");
  if (publicOrigin.startsWith("http:") && !["localhost", "127.0.0.1"].includes(new URL(publicOrigin).hostname)) {
    throw new Error("ESM_PUBLIC_ORIGIN must use https except for localhost");
  }
  return {
    port: Number(env.ESM_PORT ?? 5174),
    host: env.ESM_HOST ?? "127.0.0.1",
    publicOrigin,
    oidcIssuer: required(env, "OIDC_ISSUER"),
    oidcRedirectUri: redirect.href,
    oidcClientId: env.OIDC_CLIENT_ID?.trim() || "esm-bff",
    oidcClientSecret: required(env, "OIDC_CLIENT_SECRET"),
    platformApiUrl,
    cookieSecure: secure,
    sessionIdleMs: Number(env.ESM_SESSION_IDLE_SECONDS ?? 1800) * 1000,
    sessionMaxMs: Number(env.ESM_SESSION_MAX_SECONDS ?? 28800) * 1000,
    staticDir: env.ESM_STATIC_DIR ?? null,
  };
}
