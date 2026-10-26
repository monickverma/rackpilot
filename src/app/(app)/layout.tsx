import Link from "next/link";
import { Mark } from "@/components/brand";
import { FooterLinks, MobileNav, NavLinks } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge, Divider } from "@/components/ui";
import { one } from "@/db/client";
import { requireSession } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/context";

async function Sidebar() {
  const s = await requireSession();
  const counts = await one<{ cases: number; alerts: number }>(
    `SELECT (SELECT COUNT(*)::int FROM investigations WHERE business_id = $1 AND status NOT IN ('resolved', 'closed')) AS cases, 0 AS alerts`,
    s.businessId,
  );
  const initials = s.business.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  return (
    <div className="flex min-h-full flex-col">
      <div className="p-3">
        <Link href="/dashboard" className="grid grid-cols-[24px_1fr] items-center gap-x-3 rounded-md p-0.5 pr-2 outline-hidden transition-colors hover:bg-bg-hover focus-visible:shadow-focus">
          <Mark />
          <span className="truncate txt-compact-small-plus">RackPilot</span>
        </Link>
      </div>
      <Divider className="mx-3" />
      <NavLinks counts={{ "/investigations": counts?.cases ?? 0 }} />
      <div className="mt-auto">
        <FooterLinks canReset />
        <Divider className="mx-3" />
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-[24px_1fr] items-center gap-x-3 px-0.5">
            <span className="grid size-6 place-items-center rounded-md border border-tag-grey-line bg-tag-grey text-[11px] font-medium text-tag-grey-fg">{initials}</span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium leading-4">{s.business.name}</span>
              <span className="block truncate text-xs leading-4 text-faint">{s.user.name} · {ROLE_LABEL[s.user.role]}</span>
            </span>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  return (
    <div className="flex min-h-dvh">
      <aside className="no-print sticky top-0 hidden h-dvh w-[232px] shrink-0 overflow-y-auto border-r border-line lg:block">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-13 items-center justify-between gap-3 border-b border-line bg-bg/90 px-3 backdrop-blur lg:pl-6">
          <div className="flex min-w-0 items-center gap-x-2">
            <MobileNav>
              <Sidebar />
            </MobileNav>
            <span className="truncate txt-compact-small-plus text-muted">{s.business.name}</span>
            <span className="hidden text-faint sm:inline">·</span>
            <span className="hidden truncate text-xs text-faint sm:inline">{s.user.name}, {ROLE_LABEL[s.user.role].toLowerCase()}</span>
          </div>
          <Badge tone="warn">
            <span className="sm:hidden">Demo data</span>
            <span className="hidden sm:inline">Synthetic demo data</span>
          </Badge>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-3">{children}</main>
      </div>
    </div>
  );
}
