// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { ClipboardList, FolderTree, LayoutDashboard, LogOut, Menu, PlusCircle, ScrollText, Ticket, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useReady } from "../auth/AuthContext";
import { vi } from "../i18n/vi";

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean }

/** Navigation reflects what the backend allows for the caller (entity.allowedOperations); it is not a security boundary. */
export function navFor(ops: { ticket: Record<string, string>; category: Record<string, string> }, roles: string[]): NavItem[] {
  const items: NavItem[] = [{ to: "/", label: vi.nav.dashboard, icon: <LayoutDashboard size={18} aria-hidden="true" />, end: true }];
  const creates = Boolean(ops.ticket.create);
  const readsAll = ops.ticket.read === "all";
  if (creates) {
    items.push({ to: "/my-requests", label: vi.nav.myRequests, icon: <ClipboardList size={18} aria-hidden="true" /> });
    items.push({ to: "/tickets/new", label: vi.nav.newRequest, icon: <PlusCircle size={18} aria-hidden="true" /> });
  }
  if (readsAll) items.push({ to: "/tickets", label: vi.nav.tickets, icon: <Ticket size={18} aria-hidden="true" />, end: true });
  if (ops.category.read) items.push({ to: "/categories", label: vi.nav.categories, icon: <FolderTree size={18} aria-hidden="true" /> });
  if (ops.ticket.audit) items.push({ to: "/audit", label: vi.nav.audit, icon: <ScrollText size={18} aria-hidden="true" /> });
  void roles;
  return items;
}

export function Layout() {
  const { user, caps, signOut } = useReady();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const items = navFor({ ticket: caps.ticket.allowedOperations, category: caps.category.allowedOperations }, caps.roles);
  const roleLabel = caps.roles.map((role) => vi.roles[role] ?? role).join(", ");

  return (
    <div className="shell">
      <a href="#main" className="skip-link">{vi.nav.skip}</a>
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">O</span>
          <div>
            <strong>{vi.app.name}</strong>
            <span>{vi.app.tagline}</span>
          </div>
          <button type="button" className="icon-btn sidebar-close" aria-label={vi.nav.close} onClick={() => setOpen(false)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label={vi.nav.main}>
          <ul>
            {items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end}>{item.icon}<span>{item.label}</span></NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          <div className="profile" aria-label={vi.auth.profile}>
            <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
            <div>
              <strong>{user.name}</strong>
              <span>{roleLabel}</span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost sidebar-logout" onClick={() => void signOut()}>
            <LogOut size={16} aria-hidden="true" />{vi.auth.signOut}
          </button>
        </div>
      </aside>
      {open && <button type="button" className="scrim" aria-label={vi.nav.close} onClick={() => setOpen(false)} />}
      <div className="content">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label={vi.nav.open} aria-expanded={open} onClick={() => setOpen(true)}>
            <Menu size={20} aria-hidden="true" />
          </button>
          <Breadcrumb />
          <span className="topbar-user">{user.name}</span>
        </header>
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

const TITLES: Record<string, string> = {
  "my-requests": vi.nav.myRequests, tickets: vi.nav.tickets, new: vi.nav.newRequest, categories: vi.nav.categories,
  audit: vi.nav.audit, edit: vi.common.edit,
};

export function crumbsFor(pathname: string, staff: boolean): { to: string; label: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  const crumbs = [{ to: "/", label: vi.nav.dashboard }];
  const list = staff ? { to: "/tickets", label: vi.nav.tickets } : { to: "/my-requests", label: vi.nav.myRequests };
  const [first, second, third] = parts;
  if (first === "tickets" || first === "my-requests") {
    if (first === "my-requests" || second) crumbs.push(first === "my-requests" ? { to: "/my-requests", label: vi.nav.myRequests } : list);
    else crumbs.push({ to: "/tickets", label: vi.nav.tickets });
    if (second === "new") crumbs.push({ to: "/tickets/new", label: vi.nav.newRequest });
    else if (second) {
      crumbs.push({ to: `/tickets/${second}`, label: `${vi.ticket.singular} ${second.slice(0, 8).toUpperCase()}` });
      if (third === "edit") crumbs.push({ to: `/tickets/${second}/edit`, label: vi.common.edit });
    }
  } else if (first) {
    crumbs.push({ to: `/${first}`, label: TITLES[first] ?? first });
  }
  return crumbs;
}

export function Breadcrumb() {
  const { pathname } = useLocation();
  const { caps } = useReady();
  const crumbs = crumbsFor(pathname, caps.ticket.allowedOperations.read === "all");
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={crumb.to}>
            {index === crumbs.length - 1 ? <span aria-current="page">{crumb.label}</span> : <Link to={crumb.to}>{crumb.label}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
