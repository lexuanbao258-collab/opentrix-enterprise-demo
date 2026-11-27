// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import { CalendarCheck, CalendarDays, CalendarPlus, ClipboardList, FolderTree, Headset, LayoutDashboard, LogOut, Menu, PlusCircle, ScrollText, Ticket, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../auth/AuthContext";
import { vi } from "../i18n/vi";
import { Logo } from "./Logo";

interface Group { key: string; name: string; icon: ReactNode; to: string; items: NavItem[] }
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

/** HR Leave navigation, from the backend-reported operations on `leaveRequest` and the caller's roles. */
export function hrNavFor(ops: Record<string, string>, roles: string[]): NavItem[] {
  const items: NavItem[] = [{ to: "/hr", label: vi.nav.hrDashboard, icon: <LayoutDashboard size={18} aria-hidden="true" />, end: true }];
  if (ops.create) {
    items.push({ to: "/hr/my-requests", label: vi.nav.hrMine, icon: <ClipboardList size={18} aria-hidden="true" /> });
    items.push({ to: "/hr/requests/new", label: vi.nav.hrNew, icon: <CalendarPlus size={18} aria-hidden="true" /> });
  }
  if (roles.includes("manager")) items.push({ to: "/hr/approvals", label: vi.nav.hrApprovals, icon: <CalendarCheck size={18} aria-hidden="true" /> });
  if (ops.read === "all") items.push({ to: "/hr/requests", label: vi.nav.hrAll, icon: <Users size={18} aria-hidden="true" />, end: true });
  if (ops.audit) items.push({ to: "/hr/audit", label: vi.nav.hrAudit, icon: <ScrollText size={18} aria-hidden="true" /> });
  return items;
}

export function Layout() {
  const { user, apps, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);

  // Mobile drawer: Escape closes, focus moves in and returns to the menu button, the page behind cannot scroll,
  // and the drawer closes when the viewport grows into the desktop layout (where it is always visible).
  useEffect(() => {
    if (!open) return;
    // the drawer is still visibility:hidden for the first frame of its transition, and a hidden element cannot take focus
    const focusTimer = window.setTimeout(() => closeButton.current?.focus(), 50);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); }
    };
    const wide = window.matchMedia?.("(min-width: 861px)");
    const onWide = () => { if (wide?.matches) setOpen(false); };
    document.addEventListener("keydown", onKey);
    wide?.addEventListener?.("change", onWide);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      wide?.removeEventListener?.("change", onWide);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // One navigation group per application the caller holds a role in (discovery); headings only when there are several.
  const candidates: (Group | null | undefined)[] = [
    apps.it && { key: "it", name: vi.app.itName, icon: <Headset size={15} aria-hidden="true" />, to: "/", items: navFor({ ticket: apps.it.ticket.allowedOperations, category: apps.it.category.allowedOperations }, apps.it.roles) },
    apps.hr && { key: "hr", name: vi.app.hrName, icon: <CalendarDays size={15} aria-hidden="true" />, to: "/hr", items: hrNavFor(apps.hr.leave.allowedOperations, apps.hr.roles) },
  ];
  const groups = candidates.filter((group): group is Group => Boolean(group));
  const current = pathname === "/hr" || pathname.startsWith("/hr/") ? "hr" : "it";
  const roleLabel = [...(apps.it?.roles ?? []), ...(apps.hr?.roles ?? [])].map((role) => vi.roles[role] ?? role).join(", ");
  const closeMenu = () => { setOpen(false); menuButton.current?.focus(); };

  return (
    <div className="shell">
      <a href="#main" className="skip-link">{vi.nav.skip}</a>
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="brand">
          <Logo />
          <div className="brand-text">
            <strong>{vi.app.name}</strong>
            <span>{vi.app.tagline}</span>
          </div>
          <button type="button" ref={closeButton} className="icon-btn sidebar-close" aria-label={vi.nav.close} onClick={closeMenu}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label={vi.nav.main}>
          {groups.map((group) => (
            <div className="nav-group" key={group.key} data-app={group.key} data-current={groups.length > 1 && current === group.key}>
              {groups.length > 1 && <h2 className="nav-heading" id={`nav-${group.key}`}>{group.icon}{group.name}</h2>}
              <ul aria-labelledby={groups.length > 1 ? `nav-${group.key}` : undefined}>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end}>{item.icon}<span>{item.label}</span></NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="profile" aria-label={vi.auth.profile}>
            <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
            <div>
              <strong>{user.name}</strong>
              <span>{roleLabel}</span>
            </div>
          </div>
          <button type="button" className="btn sidebar-logout" onClick={() => void signOut()}>
            <LogOut size={16} aria-hidden="true" />{vi.auth.signOut}
          </button>
        </div>
      </aside>
      {open && <button type="button" className="scrim" aria-label={vi.nav.close} onClick={closeMenu} />}
      <div className="content">
        <header className="topbar">
          <button type="button" ref={menuButton} className="icon-btn menu-btn" aria-label={vi.nav.open} aria-expanded={open} onClick={() => setOpen(true)}>
            <Menu size={20} aria-hidden="true" />
          </button>
          <Breadcrumb />
          {groups.length > 1 ? (
            <nav className="module-switch" aria-label={vi.nav.switchApp}>
              {groups.map((group) => (
                <Link key={group.key} to={group.to} aria-current={current === group.key ? "true" : undefined}>{group.icon}{group.name}</Link>
              ))}
            </nav>
          ) : (
            groups[0] && <span className="module-label">{groups[0].name}</span>
          )}
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

export function hrCrumbsFor(pathname: string): { to: string; label: string }[] {
  const [, first, second, third] = pathname.split("/");
  const crumbs = [{ to: "/hr", label: vi.app.hrName }];
  if (first === "my-requests") crumbs.push({ to: "/hr/my-requests", label: vi.nav.hrMine });
  else if (first === "approvals") crumbs.push({ to: "/hr/approvals", label: vi.nav.hrApprovals });
  else if (first === "audit") crumbs.push({ to: "/hr/audit", label: vi.nav.hrAudit });
  else if (first === "requests") {
    if (second === "new") crumbs.push({ to: "/hr/requests/new", label: vi.nav.hrNew });
    else if (second) {
      crumbs.push({ to: `/hr/requests/${second}`, label: `${vi.leave.singular} ${second.slice(0, 8).toUpperCase()}` });
      if (third === "edit") crumbs.push({ to: `/hr/requests/${second}/edit`, label: vi.common.edit });
    } else crumbs.push({ to: "/hr/requests", label: vi.nav.hrAll });
  }
  return crumbs;
}

export function Breadcrumb() {
  const { pathname } = useLocation();
  const { apps } = useSession();
  const crumbs = pathname === "/hr" || pathname.startsWith("/hr/")
    ? hrCrumbsFor(pathname.slice(3))
    : crumbsFor(pathname, apps.it?.ticket.allowedOperations.read === "all");
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
