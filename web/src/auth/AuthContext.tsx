// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, configureClient } from "../api/client";
import type { AppInfo, Category, EntityInfo, PlatformRecord } from "../api/types";

export interface User {
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

type State =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "error"; error: unknown }
  | { status: "no-access"; user: User; csrf: string }
  | { status: "ready"; user: User; csrf: string; caps: Capabilities; categories: PlatformRecord<Category>[]; expired: boolean };

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

export function useReady() {
  const { state, ...rest } = useAuth();
  if (state.status !== "ready") throw new Error("Not signed in");
  return { ...state, ...rest };
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
        const app = await api.app();
        const [ticket, category] = await Promise.all([api.entity("ticket"), api.entity("category")]);
        const categories = await loadCategories().catch(() => []);
        if (cancelled) return;
        const roles = app.callerRoles;
        setState({
          status: "ready", user, csrf: session.csrfToken, categories, expired: false,
          caps: { app, ticket, category, roles, has: (role) => roles.includes(role) },
        });
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
