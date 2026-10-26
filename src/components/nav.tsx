"use client";

// The app's sidebar: one RackPilot interface with three work areas, as the
// spec asks: operate, investigate, optimise.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { callApi } from "./client";
import {
  ArrowLeftRightIcon, BellIcon, BoxSearchIcon, CartIcon, ChartIcon, ChatIcon, ClipboardIcon, DashboardIcon, FileSearchIcon, GlobeIcon,
  MessagePlusIcon, PackageIcon, PanelLeftIcon, ResetIcon, RouteIcon, TargetIcon, UserIcon, XIcon,
} from "./icons";
import { cn } from "./ui";

const SECTIONS = [
  {
    title: "Operate",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
      { href: "/orders/new", label: "New order", icon: MessagePlusIcon },
      { href: "/orders", label: "Orders", icon: ClipboardIcon },
      { href: "/inventory", label: "Inventory", icon: PackageIcon },
      { href: "/stock", label: "Stock moves", icon: ArrowLeftRightIcon },
    ],
  },
  {
    title: "Investigate",
    links: [
      { href: "/investigations", label: "Investigation Centre", icon: FileSearchIcon },
      { href: "/ordertrace", label: "OrderTrace", icon: RouteIcon },
      { href: "/stocksleuth", label: "StockSleuth", icon: BoxSearchIcon },
    ],
  },
  {
    title: "Optimise",
    links: [
      { href: "/alerts", label: "Alerts", icon: BellIcon },
      { href: "/analytics", label: "Analytics", icon: ChartIcon },
      { href: "/purchasing", label: "Purchasing", icon: CartIcon },
      { href: "/assistant", label: "Ask your business", icon: ChatIcon },
    ],
  },
  { title: "Proof", links: [{ href: "/metrics", label: "Measurements", icon: TargetIcon }] },
];

function active(pathname: string, href: string) {
  if (href === "/orders") return pathname.startsWith("/orders") && pathname !== "/orders/new";
  if (href === "/dashboard" || href === "/orders/new") return pathname === href;
  return pathname.startsWith(href);
}

const itemClass = (on: boolean) =>
  cn(
    "flex w-full items-center gap-x-2 rounded-md py-0.5 pl-0.5 pr-2 txt-compact-small-plus outline-hidden transition-[color,background-color,box-shadow] focus-visible:shadow-focus disabled:opacity-50",
    on ? "bg-panel text-fg shadow-card" : "text-muted hover:bg-bg-hover hover:text-fg",
  );

export function NavLinks({ counts }: { counts: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-y-3 px-3 py-3">
      {SECTIONS.map((s) => (
        <div key={s.title}>
          <div className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-faint">{s.title}</div>
          <div className="flex flex-col gap-y-0.5">
            {s.links.map(({ href, label, icon: Icon }) => {
              const on = active(pathname, href);
              return (
                <Link key={href} href={href} aria-current={on ? "page" : undefined} className={itemClass(on)}>
                  <span className="grid size-6 place-items-center">
                    <Icon size={15} />
                  </span>
                  <span className="flex-1">{label}</span>
                  {counts[href] ? <span className="rounded-full bg-tag-red px-1.5 text-[11px] font-medium text-tag-red-fg tabular">{counts[href]}</span> : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function FooterLinks({ canReset }: { canReset: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-0.5 p-3">
      <Link href="/" className={itemClass(false)}>
        <span className="grid size-6 place-items-center"><GlobeIcon size={15} /></span>
        About RackPilot
      </Link>
      <Link href="/login" className={itemClass(false)}>
        <span className="grid size-6 place-items-center"><UserIcon size={15} /></span>
        Switch user or business
      </Link>
      {canReset && (
        <button
          type="button" disabled={pending} className={itemClass(false)}
          onClick={() => {
            if (!window.confirm("Reset the demo? This regenerates both synthetic businesses as of now.")) return;
            start(async () => {
              await callApi("/api/demo", { action: "reset" });
              router.push("/dashboard");
              router.refresh();
            });
          }}
        >
          <span className="grid size-6 place-items-center"><ResetIcon size={15} className={pending ? "animate-spin" : undefined} /></span>
          {pending ? "Resetting…" : "Reset demo data"}
        </button>
      )}
    </div>
  );
}

/** Below lg the sidebar opens as a drawer. */
export function MobileNav({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const button = trigger.current;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const overflow = document.body.style.overflow;
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
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-overlay" onClick={() => setOpen(false)} aria-hidden="true" />
            <div role="dialog" aria-modal="true" aria-label="Navigation" className="absolute inset-y-2 left-2 flex w-[calc(100%-1rem)] max-w-[304px] flex-col overflow-hidden rounded-lg bg-bg shadow-modal">
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
