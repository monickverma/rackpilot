import Link from "next/link";
import { Mark } from "@/components/brand";
import { Breadcrumbs, MobileNav, NavLinks, ResetDemoButton, WebsiteLink } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge, Divider } from "@/components/ui";

function Sidebar() {
  return (
    <div className="flex min-h-full flex-col">
      <div className="p-3">
        <Link href="/dashboard" className="grid grid-cols-[24px_1fr] items-center gap-x-3 rounded-md p-0.5 pr-2 outline-hidden transition-colors hover:bg-bg-hover focus-visible:shadow-focus">
          <Mark />
          <span className="truncate txt-compact-small-plus">RackPilot</span>
        </Link>
      </div>
      <Divider className="mx-3" />
      <NavLinks />
      <div className="mt-auto">
        <div className="space-y-0.5 p-3">
          <WebsiteLink />
          <ResetDemoButton />
        </div>
        <Divider className="mx-3" />
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-[24px_1fr] items-center gap-x-3 px-0.5">
            <span className="grid size-6 place-items-center rounded-md border border-tag-grey-line bg-tag-grey text-[11px] font-medium text-tag-grey-fg">RM</span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium leading-4">Rang Mahal Garments</span>
              <span className="block truncate text-xs leading-4 text-faint">Indore · 6 racks · 307 SKUs</span>
            </span>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

function Topbar() {
  return (
    <header className="no-print sticky top-0 z-30 flex h-13 items-center justify-between gap-3 border-b border-line bg-bg/90 px-3 backdrop-blur lg:pl-6">
      <div className="flex min-w-0 items-center gap-x-1.5">
        <MobileNav>
          <Sidebar />
        </MobileNav>
        <Breadcrumbs />
      </div>
      <Badge tone="warn">
        <span className="sm:hidden">Demo data</span>
        <span className="hidden sm:inline">Synthetic demo data</span>
      </Badge>
    </header>
  );
}

/** The live demo: Medusa-style admin shell around every shop page. */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="no-print sticky top-0 hidden h-dvh w-[220px] shrink-0 overflow-y-auto border-r border-line lg:block">
        <Sidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-3">{children}</main>
      </div>
    </div>
  );
}
