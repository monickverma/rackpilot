import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import Link from "next/link";
import { Breadcrumbs, MobileNav, NavLinks, ResetDemoButton } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge, Divider } from "@/components/ui";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const robotoMono = Roboto_Mono({ variable: "--font-roboto-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "RackPilot", template: "%s · RackPilot" },
  description: "WhatsApp orders to reserved stock and rack pick lists for a small clothing shop. Rules decide stock; every number links to its ledger rows.",
};

// Runs while the HTML parses, before first paint, so a saved dark choice never flashes light.
const THEME_SCRIPT = `try{if(localStorage.getItem("rp-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

function Mark() {
  return (
    <span className="grid size-6 place-items-center rounded-md bg-inverted bg-linear-to-b from-white/12 to-transparent text-inverted-fg shadow-inverted">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 20V5M20 20V5M4 9h16M4 15h16" />
        <path d="M8 12.5h3" strokeWidth="2.4" />
      </svg>
    </span>
  );
}

function Sidebar() {
  return (
    <div className="flex min-h-full flex-col">
      <div className="p-3">
        <Link href="/" className="grid grid-cols-[24px_1fr] items-center gap-x-3 rounded-md p-0.5 pr-2 outline-hidden transition-colors hover:bg-bg-hover focus-visible:shadow-focus">
          <Mark />
          <span className="truncate txt-compact-small-plus">RackPilot</span>
        </Link>
      </div>
      <Divider className="mx-3" />
      <NavLinks />
      <div className="mt-auto">
        <div className="p-3">
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${robotoMono.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans">
        <div className="flex min-h-dvh">
          <aside className="no-print sticky top-0 hidden h-dvh w-[220px] shrink-0 overflow-y-auto border-r border-line lg:block">
            <Sidebar />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="mx-auto w-full max-w-[1600px] flex-1 p-3">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
