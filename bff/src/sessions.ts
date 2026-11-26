// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import type { TokenSet, UserClaims } from "./oidc.js";

export interface Session {
  id: string;
  csrf: string;
  user: UserClaims;
  tokens: TokenSet;
  createdAt: number;
  lastSeen: number;
  refreshing: Promise<void> | null;
}

export interface PendingLogin {
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string;
  createdAt: number;
}

const token = () => randomBytes(32).toString("base64url");
const PENDING_MS = 10 * 60 * 1000;

/**
 * Server-side session store. Tokens never reach the browser: it only holds an opaque id in an HttpOnly cookie.
 * ponytail: in-memory, single instance; sessions are lost on restart. Use Redis or a database if the BFF scales out.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, PendingLogin>();

  constructor(
    private readonly idleMs: number,
    private readonly maxMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  create(user: UserClaims, tokens: TokenSet): Session {
    const now = this.now();
    const session: Session = { id: token(), csrf: token(), user, tokens, createdAt: now, lastSeen: now, refreshing: null };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | undefined): Session | null {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    const now = this.now();
    if (now - session.lastSeen > this.idleMs || now - session.createdAt > this.maxMs) {
      this.sessions.delete(id);
      return null;
    }
    session.lastSeen = now;
    return session;
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }

  startPending(login: Omit<PendingLogin, "createdAt">): string {
    const id = token();
    this.pending.set(id, { ...login, createdAt: this.now() });
    return id;
  }

  /** One-time use; expires after 10 minutes. */
  takePending(id: string | undefined): PendingLogin | null {
    if (!id) return null;
    const login = this.pending.get(id);
    this.pending.delete(id);
    if (!login || this.now() - login.createdAt > PENDING_MS) return null;
    return login;
  }

  sweep(): void {
    for (const id of [...this.sessions.keys()]) this.get(id);
    const now = this.now();
    for (const [id, login] of this.pending) if (now - login.createdAt > PENDING_MS) this.pending.delete(id);
  }
}
