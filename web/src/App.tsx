// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { useEffect, type ReactNode } from "react";
import { Link, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth, useReady, useSession } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { Logo } from "./components/Logo";
import { Alert, Button, EmptyState, Spinner } from "./components/ui";
import { messageFor } from "./domain/errors";
import { vi } from "./i18n/vi";
import { Audit } from "./pages/Audit";
import { Categories } from "./pages/Categories";
import { Dashboard } from "./pages/Dashboard";
import { LeaveAudit } from "./pages/LeaveAudit";
import { LeaveDashboard } from "./pages/LeaveDashboard";
import { LeaveDetail } from "./pages/LeaveDetail";
import { LeaveForm } from "./pages/LeaveForm";
import { LeaveList } from "./pages/LeaveList";
import { TicketDetail } from "./pages/TicketDetail";
import { TicketForm } from "./pages/TicketForm";
import { TicketList } from "./pages/TicketList";

function Centered({ children }: { children: ReactNode }) {
  return <div className="centered"><div className="card narrow"><div className="signin-logo"><Logo size={40} /></div>{children}</div></div>;
}

/** Route guard on the same capability the backend reports; the backend still rejects unauthorized calls. */
function Allow({ when, children }: { when: (ops: { ticket: Record<string, string>; category: Record<string, string> }) => boolean; children: ReactNode }) {
  const { caps } = useReady();
  const ok = when({ ticket: caps.ticket.allowedOperations, category: caps.category.allowedOperations });
  return ok ? <>{children}</> : <EmptyState title={vi.forbidden.title} hint={vi.forbidden.body} action={<Link className="btn" to="/">{vi.nav.dashboard}</Link>} />;
}

const forbidden = () => (
  <EmptyState title={vi.forbidden.title} hint={vi.forbidden.body} action={<Link className="btn" to="/">{vi.nav.dashboard}</Link>} />
);

/** Route guard: the application must appear in discovery for the caller (the backend still authorizes every call). */
function RequireApp({ app }: { app: "it" | "hr" }) {
  const { apps } = useSession();
  return apps[app] ? <Outlet /> : forbidden();
}

/** Same capability guard, for one operation of an HR entity. */
function AllowHr({ when, children }: { when: (ops: Record<string, string>, roles: string[]) => boolean; children: ReactNode }) {
  const { apps } = useSession();
  return apps.hr && when(apps.hr.leave.allowedOperations, apps.hr.roles) ? <>{children}</> : forbidden();
}

/** "/" is the IT Helpdesk dashboard; callers without IT roles land on HR Leave. */
function Home() {
  const { apps } = useSession();
  return apps.it ? <Dashboard /> : <Navigate to="/hr" replace />;
}

export function App() {
  const { state, signIn } = useAuth();

  useEffect(() => {
    if (state.status === "anonymous") signIn();
  }, [state.status, signIn]);

  if (state.status === "loading") return <Centered><Spinner label={vi.auth.signingIn} /></Centered>;
  if (state.status === "anonymous") {
    return (
      <Centered>
        <h1>{vi.auth.signInTitle}</h1>
        <p>{vi.auth.signInBody}</p>
        <Button variant="primary" onClick={() => signIn()}>{vi.auth.signIn}</Button>
      </Centered>
    );
  }
  if (state.status === "error") {
    return <Centered><Alert tone="error" title={vi.errors.generic}>{messageFor(state.error)}</Alert><Button onClick={() => window.location.reload()}>{vi.common.retry}</Button></Centered>;
  }
  if (state.status === "no-access") {
    return <Centered><h1>{vi.auth.noAccessTitle}</h1><p>{vi.auth.noAccessBody}</p><SignOut /></Centered>;
  }
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route element={<RequireApp app="it" />}>
          <Route path="my-requests" element={<Allow when={(o) => Boolean(o.ticket.create)}><TicketList mode="mine" /></Allow>} />
          <Route path="tickets" element={<Allow when={(o) => o.ticket.read === "all"}><TicketList mode="queue" /></Allow>} />
          <Route path="tickets/new" element={<Allow when={(o) => Boolean(o.ticket.create)}><TicketForm mode="new" /></Allow>} />
          <Route path="tickets/:id" element={<TicketDetail />} />
          <Route path="tickets/:id/edit" element={<Allow when={(o) => Boolean(o.ticket.update)}><TicketForm mode="edit" /></Allow>} />
          <Route path="categories" element={<Allow when={(o) => Boolean(o.category.read)}><Categories /></Allow>} />
          <Route path="audit" element={<Allow when={(o) => Boolean(o.ticket.audit)}><Audit /></Allow>} />
          </Route>
          <Route path="hr" element={<RequireApp app="hr" />}>
            <Route index element={<LeaveDashboard />} />
            <Route path="my-requests" element={<AllowHr when={(o) => Boolean(o.create)}><LeaveList mode="mine" /></AllowHr>} />
            <Route path="approvals" element={<AllowHr when={(_o, roles) => roles.includes("manager")}><LeaveList mode="approvals" /></AllowHr>} />
            <Route path="requests" element={<AllowHr when={(o) => o.read === "all"}><LeaveList mode="all" /></AllowHr>} />
            <Route path="requests/new" element={<AllowHr when={(o) => Boolean(o.create)}><LeaveForm mode="new" /></AllowHr>} />
            <Route path="requests/:id" element={<LeaveDetail />} />
            <Route path="requests/:id/edit" element={<AllowHr when={(o) => Boolean(o.update)}><LeaveForm mode="edit" /></AllowHr>} />
            <Route path="audit" element={<AllowHr when={(o) => Boolean(o.audit)}><LeaveAudit /></AllowHr>} />
          </Route>
          <Route path="*" element={<EmptyState title={vi.notFound.title} hint={vi.notFound.body} action={<Link className="btn" to="/">{vi.nav.dashboard}</Link>} />} />
        </Route>
      </Routes>
      {state.expired && <ExpiredDialog />}
    </>
  );
}

function SignOut() {
  const { signOut } = useAuth();
  return <Button onClick={() => void signOut()}>{vi.auth.signOut}</Button>;
}

/** Shown over the page when the BFF reports that the session ended (idle timeout, revoked token, logout elsewhere). */
function ExpiredDialog() {
  const { signIn } = useAuth();
  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="expired-t" aria-describedby="expired-b">
      <div className="card narrow">
        <h2 id="expired-t">{vi.auth.expiredTitle}</h2>
        <p id="expired-b">{vi.auth.expiredBody}</p>
        <Button variant="primary" autoFocus onClick={() => signIn("/")}>{vi.auth.signIn}</Button>
      </div>
    </div>
  );
}
