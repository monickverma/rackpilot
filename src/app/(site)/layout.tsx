import Link from "next/link";
import { Mark } from "@/components/brand";
import { GithubIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { ButtonLink } from "@/components/ui";
import { SITE } from "@/lib/site";

const NAV = [["#modules", "Modules"], ["#workflow", "Workflow"], ["#investigations", "Investigations"], ["#ai", "AI architecture"], ["#measured", "Measured"]];

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 txt-compact-small-plus"><Mark /> RackPilot</Link>
          <nav className="hidden items-center gap-5 txt-compact-small text-muted md:flex">{NAV.map(([h, l]) => <a key={h} href={h} className="hover:text-fg">{l}</a>)}</nav>
          <div className="flex items-center gap-2">
            <a href={SITE.repo} className="hidden text-muted hover:text-fg sm:block" aria-label="Source on GitHub"><GithubIcon size={18} /></a>
            <ButtonLink href="/login" variant="primary" size="sm">Open the live demo</ButtonLink>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-xs text-muted">
          <span>RackPilot · operations, OrderTrace and StockSleuth for clothing businesses. The demo businesses, people and records are synthetic.</span>
          <div className="w-40"><ThemeToggle /></div>
        </div>
      </footer>
    </div>
  );
}
