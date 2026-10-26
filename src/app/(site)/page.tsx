import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Highlighted } from "@/components/highlighted";
import {
  AlertIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  GithubIcon,
  MessagePlusIcon,
  PackageIcon,
  PrinterIcon,
  ScanTextIcon,
  ScrollIcon,
  ShieldCheckIcon,
  TrendingIcon,
  TruckIcon,
} from "@/components/icons";
import { Delta, LineBadge, MovementBadge } from "@/components/status";
import { Badge, ButtonLink, IconBadge, Location, Mono, Table, Td, Th, type Tone } from "@/components/ui";
import type { LineStatus, MovementType } from "@/db/schema";
import { evaluate, pct, type CaseResult, type EvalSummary, type TestCase } from "@/lib/parser/evaluate";
import { parseOrder } from "@/lib/parser/parse";
import { REPO_URL } from "@/lib/site";
import testset from "../../../data/parser-testset.json";

export const metadata: Metadata = {
  title: { absolute: "RackPilot · WhatsApp orders to reserved stock and pick lists" },
  description:
    "RackPilot reads Hinglish WhatsApp orders, reserves the right size and colour on the right rack, and prints the pick list. Try the live demo with a made-up clothing shop.",
};

// The 90-second demo order, as the first customer in the demo inbox sends it.
const MESSAGE = "Bhaiya 3 black kurti M, 2 L, 1 maroon XL, Saturday tak";

// What confirming MESSAGE does in a freshly seeded demo shop. scripts/smoke.ts
// checks the same outcome on every test run.
const RESERVED: { sku: string; bin: string; qty: number; status: LineStatus }[] = [
  { sku: "K101-BLK-M", bin: "R1-A1", qty: 3, status: "reserved" },
  { sku: "K101-BLK-L", bin: "R1-A1", qty: 2, status: "reserved" },
  { sku: "K101-MRN-XL", bin: "R1-A2", qty: 1, status: "short" },
];

// The same order's ledger rows once it has been handed over, oldest first.
const LEDGER: { type: MovementType; sku: string; onHand: number; reserved: number }[] = [
  { type: "reserve", sku: "K101-BLK-M", onHand: 0, reserved: 3 },
  { type: "reserve", sku: "K101-BLK-L", onHand: 0, reserved: 2 },
  { type: "sale", sku: "K101-BLK-M", onHand: -3, reserved: -3 },
  { type: "sale", sku: "K101-BLK-L", onHand: -2, reserved: -2 },
];

const cases = (testset as unknown as { cases: TestCase[] }).cases;

export default function HomePage() {
  // Pure and deterministic, so this runs once at build time, like the parser page.
  const { results, summary } = evaluate(cases, parseOrder);
  return (
    <>
      <Hero summary={summary} />
      <Problem />
      <Modules />
      <HowItWorks />
      <Features />
      <Accuracy summary={summary} misses={results.filter((r) => !r.pass)} />
      <Ledger />
      <Faq />
      <Closing />
    </>
  );
}

function Section({ id, eyebrow, title, intro, children }: { id: string; eyebrow: string; title: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-14 border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="max-w-2xl">
          <p className="txt-compact-small-plus text-accent">{eyebrow}</p>
          <h2 className="mt-3 text-[28px] font-medium leading-9 tracking-[-0.02em] sm:text-[36px] sm:leading-[44px]">{title}</h2>
          {intro && <p className="mt-4 text-[15px] leading-6 text-muted">{intro}</p>}
        </div>
        <div className="mt-10 sm:mt-12">{children}</div>
      </div>
    </section>
  );
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 txt-compact-small-plus text-accent hover:underline">
      {children} <ArrowRightIcon size={14} />
    </Link>
  );
}

function Hero({ summary }: { summary: EvalSummary }) {
  const facts = [
    { value: `${summary.cases.passed}/${summary.cases.total}`, label: "test orders read exactly right" },
    { value: "307", label: "SKUs across six racks" },
    { value: "6,500+", label: "ledger rows behind the counts" },
    { value: "0", label: "stock decisions made by AI" },
  ];
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid" />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <Link
            href="/dashboard"
            className="inline-flex max-w-full items-center gap-2 rounded-full bg-panel py-1 pl-1 pr-3 txt-compact-small-plus text-muted shadow-card outline-hidden transition-shadow hover:shadow-card-hover focus-visible:shadow-active"
          >
            <span className="shrink-0 whitespace-nowrap rounded-full bg-tag-green px-2 text-tag-green-fg">Live demo</span>
            <span className="truncate sm:hidden">Try it on a made-up shop</span>
            <span className="hidden truncate sm:inline">A made-up shop with six months of orders</span>
            <ArrowRightIcon size={14} className="shrink-0" />
          </Link>
          <h1 className="mt-6 text-balance text-[40px] font-medium leading-[44px] tracking-[-0.03em] sm:text-[56px] sm:leading-[60px]">
            WhatsApp orders in. <span className="text-muted">Reserved stock and pick lists out.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-muted">
            RackPilot reads the Hinglish orders customers type on WhatsApp, holds the right size and colour on the right rack, and prints a pick list in rack order.
            Every stock number links back to the ledger rows behind it.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/dashboard" variant="primary" size="lg">
              Open the live demo <ArrowRightIcon size={16} />
            </ButtonLink>
            <ButtonLink href="/orders/new" size="lg">
              <MessagePlusIcon size={16} /> Read a WhatsApp order
            </ButtonLink>
          </div>
          <p className="mt-4 text-xs text-faint">No sign-up. Nothing you do there touches a real shop.</p>
        </div>

        <HeroDemo />

        <dl className="mx-auto mt-3 grid max-w-5xl grid-cols-2 gap-px overflow-hidden rounded-lg bg-line shadow-card lg:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="flex flex-col-reverse justify-end gap-1 bg-panel px-5 py-4">
              <dt className="txt-small text-muted">{f.label}</dt>
              <dd className="text-2xl font-medium tracking-tight tabular">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Pane({ step, title, icon, children }: { step: number; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-panel p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <IconBadge>{icon}</IconBadge>
        <span className="txt-compact-small-plus">{title}</span>
        <span className="ml-auto font-mono text-[11px] text-faint">{step}/3</span>
      </div>
      {children}
    </div>
  );
}

/** The demo order, drawn with the app's own components. The middle pane is the real parser's output. */
function HeroDemo() {
  const parsed = parseOrder(MESSAGE);
  const due = parsed.due ? parsed.due.label[0].toUpperCase() + parsed.due.label.slice(1) : null;
  return (
    <figure className="mx-auto mt-14 max-w-5xl rounded-xl bg-bg p-1.5 shadow-modal ring-1 ring-line sm:mt-16">
      <div className="flex items-center gap-3 px-2 pb-2 pt-1" aria-hidden="true">
        <span className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2.5 rounded-full bg-line-strong" />
          ))}
        </span>
        <span className="mx-auto rounded-md bg-panel-2 px-3 py-0.5 font-mono text-[11px] text-faint">rackpilot / orders / new</span>
        <span className="w-[42px]" />
      </div>
      <div className="grid gap-1.5 text-left lg:grid-cols-[1fr_1.25fr_1.15fr]">
        <Pane step={1} title="The message" icon={<MessagePlusIcon />}>
          <div className="rounded-md bg-[#efeae2] p-3 dark:bg-[#0b141a]">
            <div className="relative max-w-[94%] rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 text-[14px] leading-5 text-[#111b21] shadow-[0_1px_0.5px_rgb(11_20_26/0.13)] dark:bg-[#202c33] dark:text-[#e9edef]">
              <div className="text-[12px] font-medium text-[#1fa855]">Sunita B.</div>
              {MESSAGE}
              <span className="float-right ml-3 mt-1.5 text-[11px] leading-none text-[#667781] dark:text-[#8696a0]">10:42</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">Pasted exactly as the customer sent it.</p>
        </Pane>

        <Pane step={2} title="What RackPilot read" icon={<ScanTextIcon />}>
          <Highlighted message={MESSAGE} tokens={parsed.tokens} />
          <ul className="mt-2 space-y-1.5">
            {parsed.lines.map((l, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 txt-compact-small">
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-tag-blue px-1 font-medium text-tag-blue-fg tabular">{l.qty}</span>
                <span>{[l.product, l.colour, l.size].filter(Boolean).join(" · ")}</span>
                {l.inherited.length > 0 && <span className="text-xs text-faint">{l.inherited.join(" and ")} carried over</span>}
              </li>
            ))}
          </ul>
          {due && (
            <p className="mt-3 text-xs text-muted">
              Due <span className="font-medium text-fg">{due}</span> · read by rules, no AI
            </p>
          )}
        </Pane>

        <Pane step={3} title="Reserved on confirm" icon={<PackageIcon />}>
          <ul className="divide-y divide-line">
            {RESERVED.map((r) => (
              <li key={r.sku} className="flex items-center gap-2 py-2 first:pt-0">
                <Location code={r.bin} />
                <Mono className="min-w-0 truncate text-xs">{r.sku}</Mono>
                <span className="text-xs text-muted tabular">×{r.qty}</span>
                <span className="ml-auto">
                  <LineBadge status={r.status} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">The last maroon XL is already held for another customer, so that line is marked short instead of being promised twice.</p>
        </Pane>
      </div>
      <figcaption className="sr-only">The demo order: a WhatsApp message, what the rules parser read from it, and the stock reserved when it is confirmed.</figcaption>
    </figure>
  );
}

const PROBLEMS = [
  {
    q: "Which maroon XL is already promised to someone else?",
    a: "Confirming an order reserves each piece by size and colour, so the counter can't sell the same kurti twice.",
    href: "/inventory/K101-MRN-XL",
    cta: "See who it's held for",
  },
  {
    q: "Which bestseller will run out before the supplier can deliver?",
    a: "Low-stock flags compare free stock with the last 30 days of sales and the supplier's lead time.",
    href: "/dashboard",
    cta: "See low stock",
  },
  {
    q: "How much money is sitting in stock nobody has bought for two months?",
    a: "Dead stock is listed at cost, with how long each piece has waited on the rack.",
    href: "/inventory?flag=dead",
    cta: "See dead stock",
  },
];

function Problem() {
  return (
    <Section
      id="problem"
      eyebrow="The problem"
      title="A small shop runs on WhatsApp and memory"
      intro="A two-person kurti shop takes most of its orders as chat messages, typed the way customers talk. The owner reads each one, walks the racks, and keeps the rest in their head."
    >
      <div className="grid gap-3 md:grid-cols-3">
        {PROBLEMS.map((p) => (
          <div key={p.q} className="flex flex-col rounded-lg bg-panel p-6 shadow-card">
            <p className="text-[16px] font-medium leading-6 tracking-tight">&ldquo;{p.q}&rdquo;</p>
            <p className="mt-3 txt-small text-muted">{p.a}</p>
            <div className="mt-auto pt-5">
              <TextLink href={p.href}>{p.cta}</TextLink>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const STEPS = [
  { icon: <MessagePlusIcon />, title: "Paste the message", text: "Hinglish, sizes, colours and “Saturday tak”, exactly as the customer typed it." },
  {
    icon: <ScanTextIcon />,
    title: "Rules read it",
    text: "A rules parser finds each line's product, colour, size and quantity, and the due date. Words it doesn't know are shown to you, not guessed.",
  },
  {
    icon: <PackageIcon />,
    title: "Confirm and reserve",
    text: "Each line is matched to a SKU and its rack. Confirming reserves the free stock and shows any shortfall instead of hiding it.",
  },
  {
    icon: <PrinterIcon />,
    title: "Pick and hand over",
    text: "Print a pick list in rack order. Handing the order over turns its reservations into sales, and every change is a ledger row.",
  },
];

function HowItWorks() {
  return (
    <Section
      id="how"
      eyebrow="How it works"
      title="From a chat message to a packed bag in four steps"
      intro="This is the 90-second demo: one WhatsApp order, read, reserved, picked and handed over."
    >
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="rounded-lg bg-panel p-6 shadow-card">
            <div className="flex items-center justify-between">
              <IconBadge tone="accent">{step.icon}</IconBadge>
              <span className="font-mono text-xs text-faint">0{i + 1}</span>
            </div>
            <h3 className="mt-5 h3-core">{step.title}</h3>
            <p className="mt-2 txt-small text-muted">{step.text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-6">
        <ButtonLink href="/orders/new">
          Try it in the demo <ArrowRightIcon size={15} />
        </ButtonLink>
      </div>
    </Section>
  );
}

const LOOP = [
  { label: "Orders", detail: "WhatsApp messages become reserved order lines" },
  { label: "Inventory", detail: "Every reserve, sale and count is a ledger row" },
  { label: "Sales analysis", detail: "30-day sales for each size and colour" },
  { label: "Replenishment", detail: "Reorder quantities in supplier packs" },
  { label: "New inventory", detail: "Deliveries are received back onto the racks" },
];

const MODULES: { letter: string; title: string; text: string; href?: string; cta?: string }[] = [
  {
    letter: "A",
    title: "Inventory and rack tracking",
    text: "Every variant by size, colour, SKU and rack, with on-hand and reserved counts. Every stock change is recorded as a ledger row.",
    href: "/inventory",
    cta: "Stock by rack",
  },
  {
    letter: "B",
    title: "Smart order processing",
    text: "Paste a WhatsApp message, check the extracted lines against stock, reserve it and print a pick list. Shortages show before anything is promised.",
    href: "/orders/new",
    cta: "Read a message",
  },
  {
    letter: "C",
    title: "Owner intelligence",
    text: "Low stock, ageing stock, best sellers and reorder quantities, each with the sales and stock numbers it came from.",
    href: "/dashboard",
    cta: "Open the dashboard",
  },
  {
    letter: "D",
    title: "Ask your business",
    text: "Questions like “Which sizes are selling fastest?” will run fixed database queries and show the rows behind each answer, not a free-form AI guess.",
  },
];

function Modules() {
  return (
    <Section
      id="modules"
      eyebrow="What it covers"
      title="Four modules, one loop"
      intro="Orders draw down stock, sales show what is moving, and replenishment refills the racks. RackPilot runs the whole loop on one shared set of order, stock and sales data."
    >
      <ol className="grid gap-1.5 md:grid-cols-5" aria-label="The stock loop">
        {LOOP.map((step, i) => (
          <li key={step.label} className="relative flex items-start gap-3 rounded-lg bg-panel px-4 py-3 shadow-card md:flex-col md:gap-1">
            <span className="font-mono text-xs text-faint">0{i + 1}</span>
            <div>
              <div className="txt-compact-small-plus">{step.label}</div>
              <div className="mt-0.5 text-xs text-muted">{step.detail}</div>
            </div>
            {i < LOOP.length - 1 && (
              <ArrowRightIcon
                size={14}
                aria-hidden="true"
                className="absolute -bottom-[11px] left-[26px] z-10 rotate-90 rounded-full bg-bg text-faint md:-right-[11px] md:bottom-auto md:left-auto md:top-1/2 md:-translate-y-1/2 md:rotate-0"
              />
            )}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted">…and the next order draws on the new stock.</p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {MODULES.map((m) => (
          <div key={m.letter} className="flex flex-col rounded-lg bg-panel p-6 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-faint">Module {m.letter}</span>
              {m.href ? <Badge tone="ok">In the demo</Badge> : <Badge>Next</Badge>}
            </div>
            <h3 className="mt-4 h3-core">{m.title}</h3>
            <p className="mt-2 txt-small text-muted">{m.text}</p>
            <div className="mt-auto pt-5">
              {m.href && m.cta ? <TextLink href={m.href}>{m.cta}</TextLink> : <span className="txt-compact-small-plus text-faint">Not in this demo yet</span>}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

type Feature = { icon: ReactNode; tone: Tone; title: string; text: string; href: string; cta: string };

const ENGINES: { title: string; question: string; features: Feature[] }[] = [
  {
    title: "Operations",
    question: "What is happening in the shop right now?",
    features: [
      {
        icon: <MessagePlusIcon />,
        tone: "accent",
        title: "Reads Hinglish orders",
        text: "“ek kaala legging M”, “2 safed L”, “kal tak”. A line that continues the one before keeps its product, and unknown words are marked in red.",
        href: "/orders/new",
        cta: "Read a message",
      },
      {
        icon: <PackageIcon />,
        tone: "ok",
        title: "Reserves, not just counts",
        text: "On hand, reserved and free for every size, colour and rack. Reserved pieces can't be sold at the counter, so two orders never get the same kurti.",
        href: "/inventory",
        cta: "Stock by rack",
      },
      {
        icon: <PrinterIcon />,
        tone: "neutral",
        title: "Pick lists in rack order",
        text: "A printable list that walks the racks in order, with short lines listed separately so nothing is promised by mistake.",
        href: "/orders",
        cta: "Open an order",
      },
    ],
  },
  {
    title: "Owner intelligence",
    question: "What should the owner do next?",
    features: [
      {
        icon: <AlertIcon />,
        tone: "bad",
        title: "Warns before stock runs out",
        text: "Free stock against 30-day sales and the supplier's lead time, with the arithmetic written out on every flag.",
        href: "/dashboard",
        cta: "Low stock",
      },
      {
        icon: <TruckIcon />,
        tone: "warn",
        title: "Evidence-backed reorders",
        text: "Enough to cover the supplier's lead time plus 14 days at the last 30 days' rate, in their size-set packs, with the reason written on each suggestion.",
        href: "/dashboard",
        cta: "Reorder suggestions",
      },
      {
        icon: <TrendingIcon />,
        tone: "info",
        title: "Best sellers and dead stock",
        text: "The variants selling fastest over 30 days, and stock with no sale in 60 days, valued at cost.",
        href: "/inventory?flag=dead",
        cta: "Dead stock",
      },
    ],
  },
];

function Features() {
  return (
    <Section
      id="features"
      eyebrow="Features"
      title="Two engines on the same data"
      intro="The operations side runs the day. The intelligence side reads the same orders, stock and sales to say what to do next. Every card opens the part of the live demo that does it."
    >
      <div className="space-y-10">
        {ENGINES.map((engine) => (
          <div key={engine.title}>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="h2-core">{engine.title}</h3>
              <p className="txt-small text-muted">{engine.question}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {engine.features.map((f) => (
                <Link
                  key={f.title}
                  href={f.href}
                  className="group flex flex-col rounded-lg bg-panel p-6 shadow-card outline-hidden transition-shadow hover:shadow-card-hover focus-visible:shadow-active"
                >
                  <IconBadge tone={f.tone}>{f.icon}</IconBadge>
                  <h4 className="mt-5 h3-core">{f.title}</h4>
                  <p className="mt-2 txt-small text-muted">{f.text}</p>
                  <span className="mt-auto inline-flex items-center gap-1 pt-5 txt-compact-small-plus text-muted transition-colors group-hover:text-fg">
                    {f.cta} <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Accuracy({ summary: s, misses }: { summary: EvalSummary; misses: CaseResult[] }) {
  const stats = [
    { label: "All messages", value: `${s.cases.passed}/${s.cases.total}`, sub: `${pct(s.cases)}% fully correct` },
    { label: "Holdout", value: `${s.holdout.passed}/${s.holdout.total}`, sub: "kept aside while the rules were written" },
    { label: "Hinglish", value: `${s.hinglish.passed}/${s.hinglish.total}`, sub: `English ${s.english.passed}/${s.english.total}` },
    { label: "Due dates", value: `${s.due.passed}/${s.due.total}`, sub: "“Saturday tak”, “kal tak” and the rest" },
  ];
  return (
    <Section
      id="accuracy"
      eyebrow="Accuracy"
      title={`Measured on ${s.cases.total} hand-labelled orders`}
      intro={`${s.hinglish.total} Hinglish and ${s.english.total} English messages, labelled before the rules were written. A message counts only if every line's product, colour, size and quantity, and the due date, are exactly right.`}
    >
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid grid-cols-2 gap-3">
          {stats.map((st) => (
            <div key={st.label} className="rounded-lg bg-panel p-5 shadow-card">
              <div className="txt-compact-small-plus text-muted">{st.label}</div>
              <div className="mt-2 text-[32px] font-medium leading-10 tracking-tight tabular">{st.value}</div>
              <div className="mt-1 text-xs text-muted">{st.sub}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-col rounded-lg bg-panel p-6 shadow-card">
          <h3 className="h3-core">Where the rules still miss</h3>
          <ul className="mt-4 space-y-2">
            {misses.map((m) => (
              <li key={m.id} className="rounded-md border border-line bg-subtle px-3 py-2.5">
                <p className="text-[13px] leading-5">&ldquo;{m.message}&rdquo;</p>
                <p className="mt-1 text-xs text-faint">
                  {m.split === "holdout" ? "Holdout" : "Dev"} · {m.lang === "hinglish" ? "Hinglish" : "English"}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4 txt-small text-muted">
            They&apos;re left unfixed on purpose. When the rules aren&apos;t sure, the order screen shows the words they didn&apos;t understand and asks the owner to choose.
          </p>
          <div className="mt-auto pt-5">
            <TextLink href="/parser">See all {s.cases.total} test cases</TextLink>
          </div>
        </div>
      </div>
    </Section>
  );
}

const PRINCIPLES = [
  { icon: <ShieldCheckIcon />, title: "Reconciled on every page load", text: "The ledger is summed per SKU and compared with the stored on-hand and reserved counts." },
  { icon: <ScrollIcon />, title: "Append-only", text: "Rows are never edited. A stock count that differs adds an adjust row, with the note that explains it." },
  { icon: <PackageIcon />, title: "Reserved is its own number", text: "Free stock is on hand minus reserved, so a piece promised to one customer stays promised." },
];

function Ledger() {
  return (
    <Section
      id="ledger"
      eyebrow="Rules decide the stock"
      title="Every number has a paper trail"
      intro="AI can help read a messy message, but it never moves stock. Reservations, sales and counts are plain code inside one database transaction, and each one writes a ledger row."
    >
      <div className="grid gap-3 lg:grid-cols-[1fr_1.25fr]">
        <ul className="space-y-3">
          {PRINCIPLES.map((p) => (
            <li key={p.title} className="flex gap-4 rounded-lg bg-panel p-5 shadow-card">
              <IconBadge tone="ok">{p.icon}</IconBadge>
              <div>
                <h3 className="h3-core">{p.title}</h3>
                <p className="mt-1 txt-small text-muted">{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="overflow-hidden rounded-lg bg-panel shadow-card">
          <div className="border-b border-line px-6 py-4">
            <h3 className="h3-core">The ledger for the order above</h3>
            <p className="mt-1 txt-small text-muted">Reserved when it is confirmed, then turned into sales when it is handed over.</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>SKU</Th>
                  <Th align="right">Δ on hand</Th>
                  <Th align="right">Δ reserved</Th>
                </tr>
              </thead>
              <tbody>
                {LEDGER.map((row, i) => (
                  <tr key={i}>
                    <Td>
                      <MovementBadge type={row.type} />
                    </Td>
                    <Td>
                      <Mono>{row.sku}</Mono>
                    </Td>
                    <Td align="right">
                      <Delta n={row.onHand} />
                    </Td>
                    <Td align="right">
                      <Delta n={row.reserved} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <div className="border-t border-line px-6 py-3">
            <TextLink href="/ledger">Filter the full ledger</TextLink>
          </div>
        </div>
      </div>
    </Section>
  );
}

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Is Rang Mahal Garments a real shop?",
    a: "No. The shop, its customers and six months of its orders are generated, so the demo has realistic stock, sales and holds to work with.",
  },
  {
    q: "Will my changes in the demo stay?",
    a: "For a while. The live demo keeps its data in the server's memory and builds a fresh shop whenever the server restarts. Reset demo data, in the demo's sidebar, starts over at any time.",
  },
  {
    q: "Does AI decide anything about stock?",
    a: "No. Rules read the message, and plain code makes every reservation, sale and count. Claude can be switched on as a fallback for messages the rules can't read, and even then you confirm every line before stock moves. It's off in the live demo.",
  },
  { q: "Does it connect to WhatsApp?", a: "Not yet. You paste the message in; there's no WhatsApp Business API connection." },
  {
    q: "Can I run it myself?",
    a: (
      <>
        Yes. Clone the{" "}
        <a href={REPO_URL} className="text-accent hover:underline">
          repository
        </a>{" "}
        and run <code className="font-mono text-[12px] text-fg">npm install</code> and <code className="font-mono text-[12px] text-fg">npm run dev</code> on Node 22.18+ or 24+.
        It uses the SQLite built into Node, so there&apos;s no database to set up.
      </>
    ),
  },
];

function Faq() {
  return (
    <Section id="faq" eyebrow="FAQ" title="Questions people ask first">
      <div className="max-w-3xl divide-y divide-line overflow-hidden rounded-lg bg-panel shadow-card">
        {FAQ.map((f) => (
          <details key={f.q} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-[15px] font-medium outline-hidden transition-colors hover:bg-subtle focus-visible:bg-subtle [&::-webkit-details-marker]:hidden">
              {f.q}
              <ChevronRightIcon size={16} className="shrink-0 text-faint transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-6 pb-5 txt-small text-muted">{f.a}</div>
          </details>
        ))}
      </div>
    </Section>
  );
}

function Closing() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="relative overflow-hidden rounded-xl bg-panel px-6 py-14 text-center shadow-card sm:py-16">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid" />
          <div className="relative">
            <h2 className="text-[28px] font-medium leading-9 tracking-[-0.02em] sm:text-[36px] sm:leading-[44px]">See it with a shop full of stock</h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-6 text-muted">
              307 SKUs, six racks and six months of orders, all made up for the demo. Read an order, reserve it and print the pick list.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/dashboard" variant="primary" size="lg">
                Open the live demo <ArrowRightIcon size={16} />
              </ButtonLink>
              <ButtonLink href={REPO_URL} size="lg">
                <GithubIcon size={16} /> View the source
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
