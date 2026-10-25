import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { NavLinks, ResetDemoButton } from "@/components/nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "RackPilot", template: "%s · RackPilot" },
  description: "WhatsApp orders to reserved stock and rack pick lists for a small clothing shop. Rules decide stock; every number links to its ledger rows.",
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg shadow-card">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 20V5M20 20V5M4 9h16M4 15h16" />
          <path d="M8 12.5h3" strokeWidth="2.4" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">RackPilot</span>
    </Link>
  );
}

function ShopCard() {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="text-[13px] font-medium">Rang Mahal Garments</div>
      <div className="text-xs text-muted">Indore · 6 racks · 307 SKUs</div>
      <div className="mt-2 inline-flex rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn">Synthetic demo data</div>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <div className="flex min-h-screen">
          <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-line bg-bg px-3 py-5 lg:flex">
            <div className="px-2">
              <Logo />
            </div>
            <NavLinks layout="side" />
            <div className="mt-auto space-y-2">
              <ShopCard />
              <ResetDemoButton />
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="no-print sticky top-0 z-10 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur lg:hidden">
              <div className="mb-2 flex items-center justify-between">
                <Logo />
                <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn">Synthetic data</span>
              </div>
              <NavLinks layout="top" />
            </header>
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
