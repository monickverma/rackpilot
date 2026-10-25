"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useTransition } from "react";
import { resetDemoAction } from "@/app/actions";
import { ClipboardIcon, DashboardIcon, FlaskIcon, MessagePlusIcon, PackageIcon, ResetIcon, ScrollIcon } from "./icons";
import { cn } from "./ui";

const LINKS = [
  { href: "/", label: "Dashboard", icon: DashboardIcon, exact: true },
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

/** On dynamic routes the pathname is request data, so the active highlight streams in. */
export function NavLinks({ layout }: { layout: "side" | "top" }) {
  return (
    <Suspense fallback={<NavList layout={layout} pathname={null} />}>
      <ActiveNavList layout={layout} />
    </Suspense>
  );
}

function ActiveNavList({ layout }: { layout: "side" | "top" }) {
  return <NavList layout={layout} pathname={usePathname()} />;
}

function NavList({ layout, pathname }: { layout: "side" | "top"; pathname: string | null }) {
  return (
    <nav className={layout === "side" ? "flex flex-col gap-0.5" : "flex gap-1 overflow-x-auto"}>
      {LINKS.map(({ href, label, icon: Icon, exact }) => {
        const active = pathname !== null && isActive(pathname, href, exact);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
              active ? "bg-panel text-fg shadow-card ring-1 ring-line" : "text-muted hover:bg-panel/60 hover:text-fg",
            )}
          >
            <Icon size={15} className={active ? "text-accent" : undefined} />
            {label}
          </Link>
        );
      })}
    </nav>
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
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-panel/60 hover:text-fg disabled:opacity-50"
    >
      <ResetIcon size={14} className={pending ? "animate-spin" : undefined} />
      {pending ? "Resetting…" : "Reset demo data"}
    </button>
  );
}
