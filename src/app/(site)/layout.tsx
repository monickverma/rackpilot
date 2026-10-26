import Link from "next/link";
import { Mark } from "@/components/brand";
import { ArrowUpRightIcon, GithubIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { ButtonLink } from "@/components/ui";
import { REPO_URL, repoFile } from "@/lib/site";

const SECTIONS = [
  { href: "/#modules", label: "Modules" },
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/#accuracy", label: "Accuracy" },
  { href: "/#faq", label: "FAQ" },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-md outline-hidden focus-visible:shadow-focus">
      <Mark />
      <span className="text-[15px] font-medium tracking-tight">RackPilot</span>
    </Link>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Brand />
        <nav aria-label="Sections" className="ml-4 hidden items-center gap-1 md:flex">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="rounded-md px-2.5 py-1.5 txt-compact-small-plus text-muted outline-hidden transition-colors hover:text-fg focus-visible:shadow-focus">
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a
            href={REPO_URL}
            className="hidden h-8 items-center gap-1.5 rounded-md px-2.5 txt-compact-small-plus text-muted outline-hidden transition-colors hover:bg-ghost-hover hover:text-fg focus-visible:shadow-focus sm:inline-flex"
          >
            <GithubIcon size={15} /> GitHub
          </a>
          <ButtonLink href="/dashboard" variant="primary">
            Open live demo
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}

function FooterLinks({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="txt-compact-small-plus">{title}</h2>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => {
          const external = href.startsWith("http");
          const cls = "inline-flex items-center gap-1 txt-small text-muted transition-colors hover:text-fg";
          return (
            <li key={href}>
              {external ? (
                <a href={href} className={cls}>
                  {label} <ArrowUpRightIcon size={13} className="text-faint" />
                </a>
              ) : (
                <Link href={href} className={cls}>
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 md:grid-cols-[1fr_auto_auto] md:gap-16">
        <div className="max-w-xs sm:col-span-2 md:col-span-1">
          <Brand />
          <p className="mt-3 txt-small text-muted">WhatsApp orders to reserved stock and pick lists, for small clothing shops. A Hacker House Goa 2026 Wild Card entry.</p>
        </div>
        <FooterLinks
          title="Live demo"
          links={[
            ["Dashboard", "/dashboard"],
            ["Read a WhatsApp order", "/orders/new"],
            ["Stock by rack", "/inventory"],
            ["Ledger", "/ledger"],
            ["Parser accuracy", "/parser"],
          ]}
        />
        <FooterLinks
          title="Project"
          links={[
            ["Source on GitHub", REPO_URL],
            ["Parser eval report", repoFile("docs/parser-eval.md")],
            ["Prompt log", repoFile("docs/prompts.md")],
          ]}
        />
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-faint">The demo shop, its customers and its orders are made up. Interface styled after Medusa&apos;s admin (MIT).</p>
          <div className="w-40 shrink-0">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}

/** The public website: what RackPilot is, with links into the live demo. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
