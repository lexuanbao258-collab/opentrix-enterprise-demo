// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, configureClient, discoverApps, HR_APP, hrApi, IT_APP } from "../api/client";
import type { AppInfo, Category, EntityInfo, PlatformRecord } from "../api/types";

export interface User {
  /** Platform user id (the OIDC subject): compared with record `createdBy` to recognise the caller's own records. */
  id: string;
  name: string;
  username: string;
}

export interface Capabilities {
  app: AppInfo;
  ticket: EntityInfo;
  category: EntityInfo;
  roles: string[];
  /** Role names that decide what the navigation offers. The backend still authorizes every call. */
  has: (role: string) => boolean;
}

/** What the caller may use in the HR Leave application (from discovery and `allowedOperations`). */
export interface LeaveCapabilities {
  app: AppInfo;
  leave: EntityInfo;
  roles: string[];
  has: (role: string) => boolean;
}

/** An application is `null` when discovery shows the caller holds no role in it. */
export interface Apps {
  it: Capabilities | null;
  hr: LeaveCapabilities | null;
}

type State =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "error"; error: unknown }
  | { status: "no-access"; user: User; csrf: string }
  | { status: "ready"; user: User; csrf: string; apps: Apps; categories: PlatformRecord<Category>[]; expired: boolean };

interface AuthApi {
  state: State;
  signIn: (returnTo?: string) => void;
  signOut: () => Promise<void>;
  reloadCategories: () => Promise<void>;
}

const Context = createContext<AuthApi | null>(null);
/** Exposed so tests can render pages with a prepared signed-in state. */
export const AuthContext = Context;
export type { AuthApi, State as AuthState };

export function useAuth(): AuthApi {
  const value = useContext(Context);
  if (!value) throw new Error("AuthProvider missing");
  return value;
}

/** Signed-in state with the caller's applications; works for users who hold roles in only some of them. */
export function useSession() {
  const { state, ...rest } = useAuth();
  if (state.status !== "ready") throw new Error("Not signed in");
  return { ...state, ...rest };
}

/** For IT Helpdesk pages. They are only rendered behind a guard that checked `apps.it`. */
export function useReady() {
  const session = useSession();
  if (!session.apps.it) throw new Error("IT Helpdesk is not available to this user");
  return { ...session, caps: session.apps.it };
}

/** For HR Leave pages (rendered only behind the `apps.hr` guard). */
export function useHr() {
  const session = useSession();
  if (!session.apps.hr) throw new Error("HR Leave is not available to this user");
  return { ...session, hr: session.apps.hr };
}

function loginUrl(returnTo?: string) {
  const target = returnTo ?? `${window.location.pathname}${window.location.search}`;
  return `/bff/login?returnTo=${encodeURIComponent(target)}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const expire = useCallback(() => {
    // Keep the page mounted and put the sign-in dialog over it.
    setState((current) => (current.status === "ready" ? { ...current, expired: true } : current.status === "no-access" ? { status: "anonymous" } : current));
  }, []);

  const loadCategories = useCallback(async () => {
    const page = await api.list<Category>("category", { limit: 100 });
    return page.items;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await fetch("/bff/session", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null);
      if (cancelled) return;
      if (!session?.authenticated) {
        configureClient({ csrf: null, onSessionExpired: expire });
        return setState({ status: "anonymous" });
      }
      configureClient({ csrf: session.csrfToken, onSessionExpired: expire });
      const user: User = session.user;
      try {
        // Application discovery: only applications in which the caller holds a role are listed.
        const visible = new Map((await discoverApps()).map((app) => [app.id, app]));
        const itApp = visible.get(IT_APP);
        const hrApp = visible.get(HR_APP);
        if (!itApp && !hrApp) return setState({ status: "no-access", user, csrf: session.csrfToken });
        const [it, hr] = await Promise.all([
          itApp
            ? Promise.all([api.app(), api.entity("ticket"), api.entity("category")]).then(([app, ticket, category]): Capabilities => ({
                app, ticket, category, roles: app.callerRoles, has: (role) => app.callerRoles.includes(role),
              }))
            : null,
          hrApp
            ? Promise.all([hrApi.app(), hrApi.entity("leaveRequest")]).then(([app, leave]): LeaveCapabilities => ({
                app, leave, roles: app.callerRoles, has: (role) => app.callerRoles.includes(role),
              }))
            : null,
        ]);
        const categories = it ? await loadCategories().catch(() => []) : [];
        if (cancelled) return;
        setState({ status: "ready", user, csrf: session.csrfToken, categories, expired: false, apps: { it, hr } });
      } catch (failure) {
        if (cancelled) return;
        if (failure instanceof ApiError && failure.status === 404) setState({ status: "no-access", user, csrf: session.csrfToken });
        else if (failure instanceof ApiError && failure.status === 401) setState({ status: "anonymous" });
        else setState({ status: "error", error: failure });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expire, loadCategories]);

  const signIn = useCallback((returnTo?: string) => window.location.assign(loginUrl(returnTo)), []);

  const signOut = useCallback(async () => {
    try {
      const response = await fetch("/bff/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": state.status === "ready" || state.status === "no-access" ? state.csrf : "" },
      });
      const body = response.ok ? await response.json() : null;
      window.location.assign(body?.logoutUrl ?? "/");
    } catch {
      window.location.assign("/");
    }
  }, [state]);

  const reloadCategories = useCallback(async () => {
    const categories = await loadCategories();
    setState((current) => (current.status === "ready" ? { ...current, categories } : current));
  }, [loadCategories]);

  const value = useMemo(() => ({ state, signIn, signOut, reloadCategories }), [state, signIn, signOut, reloadCategories]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
