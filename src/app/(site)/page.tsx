import Link from "next/link";
import report from "../../../data/test-report.json" with { type: "json" };
import { ArrowRightIcon, BoxSearchIcon, ChartIcon, FileSearchIcon, RouteIcon } from "@/components/icons";
import { Badge, ButtonLink, Card, cn } from "@/components/ui";
import { RULES } from "@/lib/investigate/types";

const pct = (n: number) => `${Math.round(n * 100)}%`;

function Section({ id, eyebrow, title, intro, children, tint }: { id?: string; eyebrow: string; title: string; intro?: React.ReactNode; children: React.ReactNode; tint?: boolean }) {
  return (
    <section id={id} className={cn("scroll-mt-16 border-t border-line", tint && "bg-subtle")}>
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="text-xs font-medium uppercase tracking-wide text-accent">{eyebrow}</div>
        <h2 className="mt-2 max-w-3xl text-2xl font-medium tracking-tight sm:text-[28px] sm:leading-9">{title}</h2>
        {intro && <div className="mt-3 max-w-3xl text-[15px] leading-7 text-muted">{intro}</div>}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

const FEATURES = [
  ["A", "AI-powered order intake", "Messages, voice-note transcripts and photos or PDFs of order sheets become structured lines. Ambiguous or unknown items ask you to choose; it never invents a SKU. A confirmation screen comes before anything is reserved.", "/orders/new?sample=spec"],
  ["B", "Inventory and SKU management", "Products, designs, brands, size and colour variants, cost and price, on-hand, reserved and available, supplier and history. Damaged and quarantined stock is excluded from sellable.", "/inventory"],
  ["C", "Physical rack and location tracking", "Warehouse A → Rack R-12 → Shelf 3 → Bin 12. Search or scan to find a garment, pick by location, move stock between racks, record counts, and flag bins that need verifying.", "/inventory/BLK-TSH-M"],
  ["D", "Order fulfilment and reservations", "Validate, reserve, pick by location, dispatch, invoice. Database constraints stop two orders taking the same units. Shortfalls are explained, and the owner chooses: backorder or ship what's there.", "/orders"],
  ["E", "Stock alerts and exceptions", "Running low, can't be fulfilled, orders competing for stock, bins to verify, deadlines at risk, count discrepancies, unsold stock. Each from an explicit rule that says what triggered it.", "/alerts"],
  ["F", "Sales and inventory analytics", "Best sellers, fastest sizes and colours, trends, cover, stockout days, ageing, value at cost and margin. Gaps in the sales records are flagged, not read as dead stock.", "/analytics"],
  ["G", "Demand forecasting and replenishment", "Demand from what customers ordered, so stockouts don't hide it. The forecast is backtested against history and its error is shown.", "/analytics"],
  ["H", "Budget-aware purchasing", "“I've got ₹30,000.” A hard budget, supplier packs and minimums, customers waiting first, best margin per rupee next. Evidence, risks, assumptions and what not to reorder, all before the owner approves.", "/purchasing?budget=30000"],
  ["I", "Natural-language business assistant", "Ask in ordinary words. Each question maps to a fixed query template; the database does the arithmetic; the answer says how it was computed.", "/assistant"],
];

const AI_TABLE = [
  ["Extract order details from messages", "LLM with structured output", "Rules by default; Claude reads text, photos and PDFs into a fixed schema (optional)"],
  ["Match a description to a product", "Database search, AI-assisted if needed", "Catalogue matcher scores product words; Claude may suggest a product code, the matcher still decides"],
  ["Calculate stock availability", "Database queries and business rules", "Available = sellable on-hand − active reservations"],
  ["Reserve inventory safely", "Transactional backend logic", "Row locks, one transaction per order, CHECK (reserved ≤ on_hand)"],
  ["Find a garment's recorded location", "Inventory database", "Balances per variant and bin; search by SKU, barcode or description"],
  ["Calculate sales and gross margin", "SQL and validated financial calculations", "Dispatch records × order price − unit cost; cross-checked two ways on the Measurements page"],
  ["Forecast demand", "Statistical models, evaluated on history", "28-day ordered rate, backtested weekly against a naive baseline"],
  ["Explain a business result", "LLM grounded in retrieved results", "Claude rewords computed answers; any number or code not in the results is rejected"],
  ["Answer questions about supplier policies", "RAG over documents", "Postgres full-text search over supplier terms and house policies"],
  ["Produce a purchasing proposal", "Rules plus validated business data", "Priority funding within a hard budget, packs and minimum orders"],
  ["Decide whether records reconcile", "Deterministic rules, never an LLM", "17 OrderTrace and StockSleuth rules with versions and exceptions"],
];

export default function Home() {
  const ot = Object.entries(RULES).filter(([, r]) => r.module === "ordertrace");
  const ss = Object.entries(RULES).filter(([, r]) => r.module === "stocksleuth");
  const passed = report.results.filter((r) => r.passed).length;
  return (
    <main>
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-20 sm:pt-28">
          <Badge tone="accent">Operations · OrderTrace · StockSleuth</Badge>
          <h1 className="mt-5 max-w-4xl text-[34px] font-medium leading-[1.15] tracking-tight sm:text-5xl">
            RackPilot is an AI-powered operations and business intelligence platform for clothing businesses.
          </h1>
          <p className="mt-6 max-w-3xl text-[16px] leading-7 text-muted">
            For small clothing wholesalers, independent apparel brands and clothing retailers. It combines inventory management, order processing, physical stock tracking, fulfilment workflows, sales analytics and intelligent purchasing recommendations in one system. Two investigation modules sit on the same records: <span className="text-fg">OrderTrace</span> reconciles orders, invoices, payments and dispatches, and <span className="text-fg">StockSleuth</span> reconstructs stock movements to explain why recorded stock and the shelf disagree.
          </p>
          <p className="mt-4 max-w-3xl text-[16px] leading-7 text-muted">
            The aim is to move a clothing business from managing orders, spreadsheets, stockrooms and purchasing by hand to one system that understands its operations and helps it decide better.
          </p>
          <ol className="mt-8 grid max-w-4xl gap-px overflow-hidden rounded-lg bg-line shadow-card sm:grid-cols-4">
            {[["Orders arrive", "Messages, voice transcripts, manual entry or an uploaded order sheet"], ["Inventory and fulfilment", "Check stock, reserve items, locate garments, prepare pick lists"], ["Business intelligence", "Sales, stockouts, slow-moving products and demand"], ["Smarter purchasing", "What to reorder, in what quantity, and why"]].map(([t, d], i) => (
              <li key={t} className="bg-panel px-4 py-3"><div className="text-xs text-faint tabular">{i + 1}</div><div className="text-[13px] font-medium">{t}</div><p className="mt-0.5 text-xs text-muted">{d}</p></li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/login" variant="primary" size="lg">Open the live demo <ArrowRightIcon size={16} /></ButtonLink>
            <ButtonLink href="/login?next=/investigations/OT-001" size="lg">See an investigation</ButtonLink>
          </div>
          <p className="mt-4 text-xs text-faint">Demo sign-in, no password. Synthetic wholesaler in Gandhi Nagar, Delhi: 18 products, 220 size and colour variants, 150 days of trading.</p>
        </div>
      </section>

      <Section id="modules" eyebrow="The complete product" title="One interface, one history of business events, three responsibilities." intro="The modules are not three applications. They read the same orders, stock movements, shipments and audit records from different angles.">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            [<ChartIcon key="i" />, "Operate", "RackPilot core", "Products, variants, inventory, orders, reservations, locations, picking, dispatch, sales analytics and purchasing recommendations.", "/dashboard"],
            [<RouteIcon key="i" />, "Investigate", "OrderTrace", "Connects each order with its stock allocation, invoices, payments and dispatch records, and traces exactly where they stop agreeing.", "/ordertrace"],
            [<BoxSearchIcon key="i" />, "Investigate", "StockSleuth", "Investigates missing stock, unexplained changes, wrong reservations and misplaced goods by replaying the stock ledger.", "/stocksleuth"],
          ].map(([icon, k, t, d, href]) => (
            <Card key={t as string} className="p-6">
              <div className="flex items-center gap-2 text-accent">{icon}<span className="text-xs font-medium uppercase tracking-wide">{k}</span></div>
              <h3 className="mt-3 h2-core">{t}</h3>
              <p className="mt-2 txt-small text-muted">{d}</p>
              <Link href={`/login?next=${href}`} className="mt-4 inline-flex items-center gap-1 text-xs text-accent hover:underline">Open {t} <ArrowRightIcon size={12} /></Link>
            </Card>
          ))}
        </div>
        <Card className="mt-3 p-6">
          <div className="grid gap-4 md:grid-cols-3 txt-small">
            <p><span className="font-medium">Operate:</span> <span className="text-muted">manage the business&apos;s orders and inventory.</span></p>
            <p><span className="font-medium">Investigate:</span> <span className="text-muted">find discrepancies and reconstruct the events that caused them.</span></p>
            <p><span className="font-medium">Optimise:</span> <span className="text-muted">use the resulting sales and stock data to decide what to buy.</span></p>
          </div>
        </Card>
      </Section>

      <Section eyebrow="1 · The problem" title="Each record looks reasonable on its own. Together they disagree." tint>
        <ul className="grid gap-3 md:grid-cols-2">
          {["Orders arrive in informal messages, not an order system.", "Products have many variants: size, colour, design, SKU, sometimes batch.", "Staff know a garment is somewhere in the stockroom, not where.", "Physical stock and recorded stock drift apart.", "Several orders compete for the last units.", "Owners can't easily see which sizes and designs sell and which sit.", "Purchasing runs on intuition rather than sales, commitments and lead times.", "Invoices, payments and dispatch notes live in separate tools and don't get cross-checked."].map((p) => (
            <li key={p} className="rounded-lg bg-panel px-5 py-4 txt-small shadow-card">{p}</li>
          ))}
        </ul>
        <p className="mt-4 max-w-3xl text-xs text-faint">These are the problems RackPilot is built to address. How often and how badly each target customer has them still needs checking with real clothing-business owners.</p>
      </Section>

      <Section eyebrow="2 · Who it's for" title="Start narrow: a wholesaler or a small brand with enough orders for this to hurt.">
        <div className="grid gap-3 md:grid-cols-3">
          {[["Primary", "Small clothing wholesalers", "Many variants, repeat retailer orders, physical stock, frequent picking and packing. The main demo business, Saffron Thread Apparel, is one."], ["Secondary", "Independent apparel brands", "Own designs, variants to manage, sell-through to watch, replenishment to decide. The second demo tenant, Indigo Lane, is one."], ["Also", "Clothing retailers", "Accurate stock, fast product location, reliable fulfilment and better buying."]].map(([k, t, d]) => (
            <Card key={t} className="p-6"><Badge tone={k === "Primary" ? "accent" : "neutral"}>{k}</Badge><h3 className="mt-3 h3-core">{t}</h3><p className="mt-2 txt-small text-muted">{d}</p></Card>
          ))}
        </div>
      </Section>

      <Section id="workflow" eyebrow="4 · The end-to-end workflow" title="Every feature shares the same records, so each step improves the next." tint intro="Better order records improve inventory visibility, better visibility improves fulfilment, and better sales records improve purchasing.">
        <ol className="grid gap-px overflow-hidden rounded-lg bg-line shadow-card md:grid-cols-7">
          {[["Stock is added", "Variants registered, quantities and rack locations recorded."], ["An order arrives", "Products, sizes, colours, quantities and deadline extracted."], ["Inventory is checked", "Variants matched, availability validated, shortages named."], ["Stock is reserved", "The same units can't be allocated twice."], ["Picked and dispatched", "Location-aware pick list; fulfilment recorded."], ["Performance updates", "Sales and movements feed analytics."], ["Purchasing is recommended", "Shortages found; quantities proposed from data."]].map(([t, d], i) => (
            <li key={t} className="bg-panel p-4"><div className="text-xs text-faint tabular">Step {i + 1}</div><div className="mt-1 text-[13px] font-medium">{t}</div><p className="mt-1 text-xs text-muted">{d}</p></li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="3 · Features" title="Nine capabilities, A to I, all working in the demo.">
        <div className="grid gap-3 md:grid-cols-3">
          {FEATURES.map(([k, t, d, href]) => (
            <Card key={k} className="flex flex-col p-6">
              <span className="font-mono text-xs text-faint">{k}</span>
              <h3 className="mt-1 h3-core">{t}</h3>
              <p className="mt-2 flex-1 txt-small text-muted">{d}</p>
              <Link href={`/login?next=${encodeURIComponent(href)}`} className="mt-4 inline-flex items-center gap-1 text-xs text-accent hover:underline">Try it <ArrowRightIcon size={12} /></Link>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="investigations" eyebrow="OrderTrace and StockSleuth" title="An investigation, not another dashboard alert." tint intro="A difference is not proof of an error, and a variance is not proof of theft. The rules establish what was expected, what each record says, which records support the finding and what still needs a person to verify.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="p-6">
            <div className="flex items-center gap-2"><RouteIcon size={16} className="text-accent" /><h3 className="h2-core">The missing two shirts</h3></div>
            <p className="mt-2 txt-small text-muted">ORD-1042: 20 blue oxford shirts ordered, 20 allocated, 20 picked, SHP-501 ships 20, INV-2058 bills 18, the customer pays for 18 and the order is marked completed.</p>
            <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
              {[["Ordered", "20"], ["Allocated", "20"], ["Invoiced", "18"], ["Dispatched", "20"]].map(([k, v]) => <div key={k} className="rounded-md bg-subtle px-2 py-3"><dt className="text-xs text-muted">{k}</dt><dd className={cn("text-xl font-medium tabular", v === "18" && "text-bad")}>{v}</dd></div>)}
            </dl>
            <p className="mt-4 txt-small">OrderTrace checks for another invoice, a credit note, a return and a backorder, finds none, and opens <span className="font-mono">OT-001</span>. StockSleuth confirms the 20 left the warehouse. Three hypotheses stay labelled as unverified.</p>
            <ButtonLink href="/login?next=/investigations/OT-001" size="sm" className="mt-4">Open OT-001</ButtonLink>
          </Card>
          <Card className="p-6">
            <div className="flex items-center gap-2"><BoxSearchIcon size={16} className="text-info" /><h3 className="h2-core">Six tees have gone missing</h3></div>
            <p className="mt-2 txt-small text-muted">BLK-TSH-M at Warehouse A → Rack R-12 → Shelf 3 → Bin 12: recorded 50, counted 44.</p>
            <ol className="mt-4 space-y-1.5 text-xs">
              {[["09:00", "Stock received", "50 on record"], ["10:15", "4 picked for ORD-1043", "booked here until dispatch"], ["11:30", "TRF-0087: 2 sent to the showroom rail", "never scanned in"], ["12:40", "ORD-1043 cancelled", "the picked reservation isn't released"], ["14:00", "Physical count", "44 on the shelf"]].map(([t, a, b]) => <li key={t} className="grid grid-cols-[44px_1fr] gap-2"><span className="text-faint tabular">{t}</span><span><span className="font-medium">{a}</span> <span className="text-muted">· {b}</span></span></li>)}
            </ol>
            <p className="mt-4 txt-small">StockSleuth opens <span className="font-mono">SS-004</span>: open records could explain 6 of the 6 units, likely in the packing area and on the rail. The recommended next step is to recount before approving any adjustment.</p>
            <ButtonLink href="/login?next=/investigations/SS-004" size="sm" className="mt-4">Open SS-004</ButtonLink>
          </Card>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {[["OrderTrace rules", ot], ["StockSleuth rules", ss]].map(([t, list]) => (
            <Card key={t as string} className="p-6">
              <h3 className="h3-core">{t as string}</h3>
              <ul className="mt-3 space-y-2 text-xs">{(list as [string, { name: string; detects: string }][]).map(([id, r]) => <li key={id}><span className="font-mono text-faint">{id}</span> <span className="font-medium">{r.name}</span> <span className="text-muted">— {r.detects}</span></li>)}</ul>
            </Card>
          ))}
        </div>
        <Card className="mt-3 p-6">
          <div className="flex items-center gap-2"><FileSearchIcon size={16} /><h3 className="h3-core">The shared investigation engine</h3></div>
          <div className="mt-4 grid gap-4 md:grid-cols-4 txt-small">
            {[["Fact", "The invoice lists 18 units and the dispatch record lists 20."], ["Inference", "The transaction may have an invoicing discrepancy."], ["Unverified hypothesis", "The invoice may be missing a line item."], ["Resolution", "An authorised employee confirms the quantity and records the correction."]].map(([k, v]) => <div key={k}><div className="font-medium">{k}</div><p className="mt-1 text-muted">{v}</p></div>)}
          </div>
          <p className="mt-5 text-xs text-muted">Lifecycle: detected → investigating → action required → resolved → closed. Outcomes include record corrected, goods located, adjustment approved, counting error, false positive, legitimate partial fulfilment and awaiting external confirmation. Each finding stores its rule and version, the expected and actual values, the calculation, the exceptions checked and its source records. Corrections are new, audited records, and a resolved finding never reopens the case.</p>
        </Card>
      </Section>

      <Section id="ai" eyebrow="5 · What the AI actually does" title="An AI-enabled business system, not an LLM that controls everything." intro="The database and deterministic rules own stock, order state and money. Claude reads messy input and explains results it is handed; anything it writes is checked against the records first. Without an API key, every feature still works on rules.">
        <div className="overflow-x-auto rounded-lg bg-panel shadow-card">
          <table className="w-full text-left txt-compact-small">
            <thead><tr className="border-b border-line bg-subtle text-muted"><th className="px-5 py-3 font-medium">Task</th><th className="px-5 py-3 font-medium">Mechanism</th><th className="px-5 py-3 font-medium">In RackPilot</th></tr></thead>
            <tbody>{AI_TABLE.map(([a, b, c]) => <tr key={a} className="border-b border-line last:border-0"><td className="px-5 py-3 font-medium">{a}</td><td className="px-5 py-3 text-muted">{b}</td><td className="px-5 py-3 text-muted">{c}</td></tr>)}</tbody>
          </table>
        </div>
      </Section>

      <Section eyebrow="6 · Architecture" title="Next.js, a Node backend API, PostgreSQL, and one schema for all three modules." tint>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="p-6 txt-small">
            <ol className="space-y-3">
              {[["Next.js frontend", "Dashboard, orders, inventory, pick lists, OrderTrace, StockSleuth, Investigation Centre, analytics, purchasing, assistant."], ["Backend API (Next.js route handlers, TypeScript)", "Session, tenant scoping, zod validation, role permissions, workflow orchestration; the checks re-run after every write."], ["PostgreSQL", "Run in-process by PGlite for the demo. Append-only ledger and audit trail enforced by triggers; CHECK constraints stop overselling."], ["AI services", "Claude for extraction, routing and explanation, with structured outputs and grounding checks."], ["Validated outputs", "Stock numbers that rebuild from the ledger, traceable findings and recommendations, owner-approved actions."]].map(([t, d]) => <li key={t}><div className="font-medium">{t}</div><div className="text-muted">{d}</div></li>)}
            </ol>
          </Card>
          <Card className="p-6">
            <h3 className="h3-core">The shared data model</h3>
            <p className="mt-2 font-mono text-[12px] leading-6 text-muted">businesses · users · suppliers · customers · products · product_variants · locations · inventory_balances · stock_movements · orders · order_items · reservations · pick_lists · invoices / invoice_items · payments · shipments / shipment_items · transfers · returns · purchase_orders / receipts · physical_stock_counts · investigations · investigation_findings · investigation_evidence · investigation_events · audit_events · recommendations · documents</p>
            <p className="mt-3 text-xs text-muted">Every business-owned row carries its business; the backend scopes every query to the signed-in user&apos;s business. Two tenants share the demo to show it.</p>
          </Card>
        </div>
      </Section>

      <Section eyebrow="7 · What makes it different" title="Not that it uses AI, or that it manages inventory. Those exist.">
        <div className="grid gap-3 md:grid-cols-3">
          {[["Less manual work", "Informal orders become structured operational records."], ["Operational accuracy", "Every order, movement and reservation is reflected consistently, and checked."], ["Actionable intelligence", "Traceable recommendations and evidence-backed investigations rather than static charts."]].map(([t, d]) => <Card key={t} className="p-6"><h3 className="h3-core">{t}</h3><p className="mt-2 txt-small text-muted">{d}</p></Card>)}
        </div>
        <p className="mt-6 max-w-3xl text-[15px] leading-7">RackPilot connects everyday clothing-business operations with evidence-backed investigations into why recorded transactions and stock don&apos;t reconcile.</p>
      </Section>

      <Section eyebrow="8 · Hackathon MVP versus the full product" title="What is built, and what is next." tint>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["Built now", "ok", ["Realistic clothing catalogue with sizes, colours and rack locations", "Message, voice-transcript and document order intake with confirmation", "Availability checks and safe reservations", "Location-aware pick lists", "Shortage and low-stock alerts", "Budget-aware replenishment from sample sales", "OrderTrace and StockSleuth rules, shared Investigation Centre, grounded explanation, authorised corrections with audit trail", "Dashboard showing the whole workflow"]],
            ["Phase 2", "neutral", ["Barcode or QR scanning with a device camera (today: keyboard-wedge scanners and SKU search)", "Fuller supplier and purchase-order management", "Returns to suppliers", "Multi-period reporting", "Real authentication (Supabase Auth) on the same role checks", "Configurable reorder rules"]],
            ["Phase 3", "neutral", ["WhatsApp and other channel integrations", "Camera-assisted intake", "Multiple warehouses", "Seasonal forecasting once a year of history exists", "Supplier lead-time learning", "Accounting and sales-channel integrations"]],
          ].map(([t, tone, items]) => (
            <Card key={t as string} className="p-6">
              <Badge tone={tone as "ok" | "neutral"}>{t as string}</Badge>
              <ul className="mt-3 list-disc space-y-1.5 pl-4 txt-small text-muted">{(items as string[]).map((i) => <li key={i}>{i}</li>)}</ul>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="measured" eyebrow="9 · How success is measured" title="Measured on the prototype, not claimed." intro="Numbers from the repository's own test sets and test run. The Measurements page in the demo recomputes most of them live.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [`${report.intake.exact}/${report.intake.cases}`, "order messages read fully right", `holdout ${report.intake.bySet.holdout.exact}/${report.intake.bySet.holdout.cases}; ambiguous lines asked ${report.intake.asked.correct}/${report.intake.asked.expected}; unknown variants refused ${report.intake.refused.correct}/${report.intake.refused.expected}`],
            [`${report.retrieval.top1}/${report.retrieval.cases}`, "policy questions answered from the right section", `top 3: ${report.retrieval.top3}/${report.retrieval.cases}`],
            [pct(report.backtest.productWape), "forecast error per product and week", `naive baseline ${pct(report.backtest.productNaiveWape)}; per variant ${pct(report.backtest.wape)}`],
            [`${passed}/${report.results.length}`, "tests pass", "demo scenario, ambiguous and unknown orders, insufficient stock, simultaneous orders, missing history, tenants, roles"],
          ].map(([v, l, d]) => <Card key={l} className="p-6"><div className="text-3xl font-medium tracking-tight tabular">{v}</div><div className="mt-1 text-[13px] font-medium">{l}</div><p className="mt-2 text-xs text-muted">{d}</p></Card>)}
        </div>
        <p className="mt-4 text-xs text-faint">Not yet measured: time to locate and pick (needs staff trials), usefulness of proposed quantities (needs owners), and the Claude reader&apos;s accuracy (needs a paid evaluation run).</p>
      </Section>

      <section className="border-t border-line bg-inverted text-inverted-fg">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">10 · The product in one definition</div>
          <p className="mt-4 max-w-4xl text-[17px] leading-8 opacity-95">
            RackPilot is an AI-assisted operations and business-intelligence platform for small clothing wholesalers and apparel businesses. It manages orders, stock, warehouse locations, fulfilment, sales analysis and purchasing decisions. Its OrderTrace module reconciles orders, invoices, payments and dispatch records to uncover transaction discrepancies. Its StockSleuth module reconstructs inventory movements to investigate stock variances, missing movement records, incorrect reservations and location inconsistencies. Both share an investigation engine that presents source-linked evidence, separates verified facts from hypotheses, recommends checks and records authorised resolutions.
          </p>
          <div className="mt-8"><ButtonLink href="/login" size="lg">Open the live demo <ArrowRightIcon size={16} /></ButtonLink></div>
        </div>
      </section>
    </main>
  );
}
