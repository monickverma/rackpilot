"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { resetDemoAction } from "@/app/actions";
import { orderCode } from "@/lib/format";
import { ClipboardIcon, DashboardIcon, FlaskIcon, GlobeIcon, MessagePlusIcon, PackageIcon, PanelLeftIcon, ResetIcon, ScrollIcon, TriangleRightIcon, XIcon } from "./icons";
import { cn } from "./ui";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon, exact: true },
  { href: "/orders/new", label: "New order", icon: MessagePlusIcon, exact: true },
  { href: "/orders", label: "Orders", icon: ClipboardIcon, exact: false },
  { href: "/inventory", label: "Inventory", icon: PackageIcon, exact: false },
  { href: "/ledger", label: "Ledger", icon: ScrollIcon, exact: false },
  { href: "/parser", label: "Parser accuracy", icon: FlaskIcon, exact: false },
];

function isActive(pathname: string, href: string, exact: boolean) {
  if (exact) return pathname === href;
  if (href === "/orders") return pathname.startsWith("/orders") && pathname !== "/orders/new";
  return pathname.startsWith(href);
}

/** Medusa's sidebar item: the current page sits raised on the sidebar. */
const itemClass = (active: boolean) =>
  cn(
    "flex w-full items-center gap-x-2 rounded-md py-0.5 pl-0.5 pr-2 txt-compact-small-plus outline-hidden transition-[color,background-color,box-shadow] focus-visible:shadow-focus disabled:opacity-50",
    active ? "bg-panel text-fg shadow-card" : "text-muted hover:bg-bg-hover hover:text-fg",
  );

/** On dynamic routes the pathname is request data, so the active highlight streams in. */
export function NavLinks() {
  return (
    <Suspense fallback={<NavList pathname={null} />}>
      <ActiveNavList />
    </Suspense>
  );
}

function ActiveNavList() {
  return <NavList pathname={usePathname()} />;
}

function NavList({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-y-0.5 px-3 py-3">
      {LINKS.map(({ href, label, icon: Icon, exact }) => {
        const active = pathname !== null && isActive(pathname, href, exact);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={itemClass(active)}>
            <span className="grid size-6 place-items-center">
              <Icon size={15} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Back to the website at /, which explains what the demo is. */
export function WebsiteLink() {
  return (
    <Link href="/" className={itemClass(false)}>
      <span className="grid size-6 place-items-center">
        <GlobeIcon size={15} />
      </span>
      About RackPilot
    </Link>
  );
}

export function ResetDemoButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Reset the demo? This regenerates six months of synthetic stock and orders as of now.")) start(() => resetDemoAction());
      }}
      className={itemClass(false)}
    >
      <span className="grid size-6 place-items-center">
        <ResetIcon size={15} className={pending ? "animate-spin" : undefined} />
      </span>
      {pending ? "Resetting…" : "Reset demo data"}
    </button>
  );
}

interface Crumb {
  label: string;
  href?: string;
}

function crumbsFor(pathname: string): Crumb[] {
  const [section, id, sub] = pathname.split("/").filter(Boolean);
  if (section === "dashboard") return [{ label: "Dashboard" }];
  if (section === "orders") {
    const orders = { label: "Orders", href: "/orders" };
    if (!id) return [{ label: "Orders" }];
    if (id === "new") return [orders, { label: "New order" }];
    const code = /^\d+$/.test(id) ? orderCode(Number(id)) : id;
    return sub === "pick" ? [orders, { label: code, href: `/orders/${id}` }, { label: "Pick list" }] : [orders, { label: code }];
  }
  if (section === "inventory") {
    if (!id) return [{ label: "Inventory" }];
    let sku = id;
    try {
      sku = decodeURIComponent(id);
    } catch {
      // Malformed escape: show the raw segment.
    }
    return [{ label: "Inventory", href: "/inventory" }, { label: sku }];
  }
  if (section === "ledger") return [{ label: "Ledger" }];
  if (section === "parser") return [{ label: "Parser accuracy" }];
  return [{ label: "Not found" }];
}

export function Breadcrumbs() {
  return (
    <Suspense fallback={null}>
      <ActiveBreadcrumbs />
    </Suspense>
  );
}

function ActiveBreadcrumbs() {
  const crumbs = crumbsFor(usePathname());
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center txt-compact-small-plus text-faint">
        {crumbs.map((c, i) => (
          <li key={`${i}-${c.label}`} className="flex min-w-0 items-center">
            {i > 0 && <TriangleRightIcon size={15} className="mx-1.5 shrink-0 text-disabled" />}
            {c.href ? (
              <Link href={c.href} className="truncate rounded-sm transition-colors hover:text-muted">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate text-muted">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Below lg the sidebar opens as a drawer, as in Medusa's admin. */
export function MobileNav({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const button = trigger.current;
    const overflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      button?.focus();
    };
  }, [open]);

  const iconButton = "grid size-7 place-items-center rounded-md text-faint outline-hidden transition-[color,background-color,box-shadow] hover:bg-ghost-hover hover:text-fg focus-visible:shadow-focus";

  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open} className={cn(iconButton, "lg:hidden")}>
        <PanelLeftIcon size={16} />
      </button>
      {/* Portalled: the top bar's backdrop blur would otherwise contain the fixed drawer. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-overlay" onClick={() => setOpen(false)} aria-hidden="true" />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="absolute inset-y-2 left-2 flex w-[calc(100%-1rem)] max-w-[304px] flex-col overflow-hidden rounded-lg bg-bg shadow-modal"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) setOpen(false);
              }}
            >
              <div className="px-3 pt-3">
                <button type="button" autoFocus onClick={() => setOpen(false)} aria-label="Close navigation" className={iconButton}>
                  <XIcon size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
