// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Config } from "./config.js";
import { platformActorId, type OidcPort } from "./oidc.js";
import { cleanQuery, matchRoute } from "./routes.js";
import { type Session, SessionStore } from "./sessions.js";

export interface Deps {
  config: Config;
  oidc: OidcPort;
  sessions: SessionStore;
  fetchImpl?: typeof fetch;
}

const SID = "esm_sid";
const LOGIN = "esm_login";
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_BODY = 64 * 1024;
/** Errors that prove the request never reached the Platform. */
const NOT_SENT = new Set([
  "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function problem(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ status, code, message, errors: {} });
}

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function same(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

function safeReturnTo(value: unknown): string {
  return typeof value === "string" && /^\/(?!\/)[A-Za-z0-9/_\-?=&%.]{0,200}$/.test(value) ? value : "/";
}

export function createApp({ config, oidc, sessions, fetchImpl = fetch }: Deps) {
  const app = express();
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' " + config.oidcIssuer.replace(/\/realms.*$/, ""),
    );
    if (config.cookieSecure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });

  const setCookie = (res: Response, name: string, value: string, path: string, maxAgeSeconds?: number) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, "HttpOnly", "SameSite=Lax"];
    if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
    if (config.cookieSecure) parts.push("Secure");
    res.append("Set-Cookie", parts.join("; "));
  };
  const clearSession = (res: Response) => setCookie(res, SID, "", "/", 0);

  const current = (req: Request): Session | null => sessions.get(cookies(req)[SID]);

  // ---- login ----------------------------------------------------------------------------------------------
  app.get("/bff/login", async (req, res) => {
    try {
      const start = await oidc.startLogin();
      const pending = sessions.startPending({
        codeVerifier: start.codeVerifier,
        state: start.state,
        nonce: start.nonce,
        returnTo: safeReturnTo(req.query.returnTo),
      });
      setCookie(res, LOGIN, pending, "/bff/callback", 600);
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, start.url);
    } catch {
      problem(res, 502, "IDENTITY_PROVIDER_UNAVAILABLE", "Identity provider is unavailable");
    }
  });

  app.get("/bff/callback", async (req, res) => {
    const pending = sessions.takePending(cookies(req)[LOGIN]);
    setCookie(res, LOGIN, "", "/bff/callback", 0);
    res.setHeader("Cache-Control", "no-store");
    if (!pending) return problem(res, 400, "LOGIN_EXPIRED", "Login attempt is unknown or expired");
    try {
      const callback = new URL(config.oidcRedirectUri);
      callback.search = new URL(req.originalUrl, config.publicOrigin).search;
      const result = await oidc.finishLogin(callback, pending);
      sessions.destroy(cookies(req)[SID]);
      const session = sessions.create(result.user, result.tokens);
      setCookie(res, SID, session.id, "/");
      res.redirect(302, pending.returnTo);
    } catch {
      problem(res, 401, "LOGIN_FAILED", "Login could not be completed");
    }
  });

  // ---- session ---------------------------------------------------------------------------------------------
  app.get("/bff/session", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const session = current(req);
    if (!session) return void res.json({ authenticated: false });
    res.json({ authenticated: true, user: { id: platformActorId(session.user.iss, session.user.sub), name: session.user.name, username: session.user.username }, csrfToken: session.csrf });
  });

  /** State-changing requests need the session, the CSRF token and a same-origin Origin header. */
  const requireCsrf = (req: Request, res: Response, next: NextFunction) => {
    const session = current(req);
    if (!session) return problem(res, 401, "SESSION_EXPIRED", "Session ended; sign in again");
    const token = req.header("x-csrf-token");
    if (req.header("origin") !== config.publicOrigin || !token || !same(token, session.csrf)) {
      return problem(res, 403, "CSRF_REJECTED", "Request rejected");
    }
    next();
  };

  app.post("/bff/logout", requireCsrf, async (req, res) => {
    const session = current(req);
    sessions.destroy(session?.id);
    clearSession(res);
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json({ logoutUrl: await oidc.logoutUrl(session?.tokens.idToken ?? null) });
    } catch {
      res.json({ logoutUrl: `${config.publicOrigin}/` });
    }
  });

  // ---- Platform API proxy ------------------------------------------------------------------------------------
  const ensureFresh = async (session: Session): Promise<boolean> => {
    if (session.tokens.expiresAt - Date.now() > 30_000) return true;
    if (!session.tokens.refreshToken) return false;
    session.refreshing ??= (async () => {
      session.tokens = await oidc.refresh(session.tokens.refreshToken as string);
    })().finally(() => {
      session.refreshing = null;
    });
    try {
      await session.refreshing;
      return true;
    } catch {
      return false;
    }
  };

  const rawBody = express.raw({ type: () => true, limit: MAX_BODY });

  app.all(/^\/bff\/api\/.*/, rawBody, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.originalUrl, config.publicOrigin);
    const route = matchRoute(req.method, url.pathname);
    if (!route) return problem(res, 404, "NOT_FOUND", "Resource not found");
    const session = current(req);
    if (!session) return problem(res, 401, "SESSION_EXPIRED", "Session ended; sign in again");
    const write = req.method !== "GET";
    if (write) {
      const token = req.header("x-csrf-token");
      if (req.header("origin") !== config.publicOrigin || !token || !same(token, session.csrf)) {
        return problem(res, 403, "CSRF_REJECTED", "Request rejected");
      }
    }
    const hasBody = req.method === "POST" || req.method === "PUT";
    if (hasBody && !req.is("application/json")) return problem(res, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
    if (!(await ensureFresh(session))) {
      sessions.destroy(session.id);
      clearSession(res);
      return problem(res, 401, "SESSION_EXPIRED", "Session ended; sign in again");
    }
    const target = `${config.platformApiUrl}/api/v1/apps${route.upstream}${cleanQuery(url.searchParams)}`;
    try {
      const upstream = await fetchImpl(target, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${session.tokens.accessToken}`,
          Accept: "application/json",
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
        },
        body: hasBody && Buffer.isBuffer(req.body) && req.body.length ? new Uint8Array(req.body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (upstream.status === 401) {
        sessions.destroy(session.id);
        clearSession(res);
        return problem(res, 401, "SESSION_EXPIRED", "Session ended; sign in again");
      }
      // A 500 or a missing upstream reply does not establish whether a write committed.
      if (write && [500, 502, 504].includes(upstream.status)) {
        return problem(res, 503, "COMMIT_OUTCOME_UNKNOWN", "The write may or may not have been applied; read the record before repeating it");
      }
      if (upstream.status === 502 || upstream.status === 504) {
        return problem(res, 502, "PLATFORM_UNAVAILABLE", "The Platform API is unavailable");
      }
      const text = await upstream.text();
      res.status(upstream.status);
      const type = upstream.headers.get("content-type");
      if (type) res.setHeader("Content-Type", type);
      res.send(upstream.status === 204 ? undefined : text);
    } catch (failure) {
      const cause = (failure as { cause?: { code?: string } }).cause?.code ?? "";
      // A write that may have reached the Platform must be reconciled by reading, never repeated blindly.
      if (write && !NOT_SENT.has(cause)) {
        return problem(res, 503, "COMMIT_OUTCOME_UNKNOWN", "The write may or may not have been applied; read the record before repeating it");
      }
      problem(res, 502, "PLATFORM_UNAVAILABLE", "The Platform API is unavailable");
    }
  });

  // ---- static SPA ----------------------------------------------------------------------------------------------
  app.use("/bff", (_req, res) => problem(res, 404, "NOT_FOUND", "Resource not found"));
  if (config.staticDir && existsSync(config.staticDir)) {
    const dir = resolve(config.staticDir);
    app.use(express.static(dir, { index: false, maxAge: "1h", setHeaders: (res, file) => {
      if (file.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
    } }));
    app.get(/^\/(?!bff\/).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(join(dir, "index.html"));
    });
  }
  return app;
}
