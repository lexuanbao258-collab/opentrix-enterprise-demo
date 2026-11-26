// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { useEffect, type ReactNode } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { useAuth, useReady } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { Alert, Button, EmptyState, Spinner } from "./components/ui";
import { messageFor } from "./domain/errors";
import { vi } from "./i18n/vi";
import { Audit } from "./pages/Audit";
import { Categories } from "./pages/Categories";
import { Dashboard } from "./pages/Dashboard";
import { TicketDetail } from "./pages/TicketDetail";
import { TicketForm } from "./pages/TicketForm";
import { TicketList } from "./pages/TicketList";

function Centered({ children }: { children: ReactNode }) {
  return <div className="centered"><div className="card narrow">{children}</div></div>;
}

/** Route guard on the same capability the backend reports; the backend still rejects unauthorized calls. */
function Allow({ when, children }: { when: (ops: { ticket: Record<string, string>; category: Record<string, string> }) => boolean; children: ReactNode }) {
  const { caps } = useReady();
  const ok = when({ ticket: caps.ticket.allowedOperations, category: caps.category.allowedOperations });
  return ok ? <>{children}</> : <EmptyState title={vi.forbidden.title} hint={vi.forbidden.body} action={<Link className="btn" to="/">{vi.nav.dashboard}</Link>} />;
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
          <Route index element={<Dashboard />} />
          <Route path="my-requests" element={<Allow when={(o) => Boolean(o.ticket.create)}><TicketList mode="mine" /></Allow>} />
          <Route path="tickets" element={<Allow when={(o) => o.ticket.read === "all"}><TicketList mode="queue" /></Allow>} />
          <Route path="tickets/new" element={<Allow when={(o) => Boolean(o.ticket.create)}><TicketForm mode="new" /></Allow>} />
          <Route path="tickets/:id" element={<TicketDetail />} />
          <Route path="tickets/:id/edit" element={<Allow when={(o) => Boolean(o.ticket.update)}><TicketForm mode="edit" /></Allow>} />
          <Route path="categories" element={<Allow when={(o) => Boolean(o.category.read)}><Categories /></Allow>} />
          <Route path="audit" element={<Allow when={(o) => Boolean(o.ticket.audit)}><Audit /></Allow>} />
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
