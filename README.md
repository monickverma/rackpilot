# RackPilot

RackPilot is an AI-powered operations and business intelligence platform for small clothing wholesalers, independent apparel brands and clothing retailers. It combines inventory management, order processing, physical stock tracking, fulfilment workflows, sales analytics and intelligent purchasing recommendations in one system.

Two investigation modules work on the same records:

- **OrderTrace** reconciles orders, stock allocations, invoices, payments and dispatches, and shows where they stop agreeing.
- **StockSleuth** reconstructs stock movements to explain why recorded stock and the shelf disagree.

Hacker House Goa 2026 Wild Card entry. The product follows the two specifications in [`docs/spec/`](docs/spec/): [the RackPilot specification](docs/spec/rackpilot-spec.md) and [OrderTrace and StockSleuth](docs/spec/ordertrace-stocksleuth-spec.md).

- **Demo video:** _link to be added_
- **Live demo:** [rackpilot-eta.vercel.app](https://rackpilot-eta.vercel.app) (production deploys from `main`). Or [run it locally](#run-it).

## What it does

One interface, one history of business events, and three areas of work:

| Area | Question | In the demo |
| --- | --- | --- |
| Operate | What is happening right now? | Order intake from messages, voice transcripts and order-sheet photos or PDFs; inventory by size, colour and rack location; reservations; location-sorted pick lists; dispatch; invoices and payments |
| Investigate | Why don't the records agree? | OrderTrace and StockSleuth rules, the Investigation Centre, grounded explanations, authorised corrections with an audit trail |
| Optimise | What should the owner do next? | Alerts, sales and stock analytics, a backtested demand forecast, budget-aware purchasing ("I've got ₹30,000"), and a question box over fixed query templates |

The spec's features A to I all work in the demo:

| | Feature | Where |
| --- | --- | --- |
| A | AI-powered order intake | `/orders/new` |
| B | Inventory and SKU management | `/inventory`, `/inventory/[sku]` |
| C | Physical rack and location tracking | Warehouse → rack → shelf → bin on every balance, transfer and count |
| D | Order fulfilment and stock reservation | `/orders/[code]`, pick lists |
| E | Stock alerts and exceptions | `/alerts` |
| F | Sales and inventory analytics | `/analytics` |
| G | Demand forecasting and replenishment | `/analytics`, `/purchasing` |
| H | Budget-aware purchasing | `/purchasing` |
| I | Natural-language assistant | `/assistant` |

## The demo

Sign in as **Arjun Malhotra (owner)** at `/login`. The demo business, Saffron Thread Apparel, is a synthetic wholesaler in Gandhi Nagar, Delhi, with 150 days of trading. The spec's two scenarios were planted in yesterday's records.

**The missing two shirts (OT-001).**

1. Mehra Menswear ordered 20 blue oxford shirts (`ORD-1042`, 10:04).
2. All 20 were allocated (10:15), picked and shipped on `SHP-501` (11:20).
3. `INV-2058` billed only 18 (11:02). The customer paid for 18, and the order was marked completed.
4. OrderTrace checks for another invoice, a credit note, a return and a backorder. It finds none, so it opens `OT-001`.
5. StockSleuth adds that the stock records agree with the dispatch.
6. The case keeps facts, inferences and hypotheses apart. It lists the checks to do and offers two corrections: a supplementary invoice, or a ₹0 line for free pieces.

**Six tees missing from Rack R-12 (SS-004).**

1. `BLK-TSH-M` at A-R12-S3-B12 shows 50 on record and 44 counted at 14:00.
2. StockSleuth replays the bin's movements:
   - 4 units were picked for `ORD-1043`, which was then cancelled without its reservation being released.
   - `TRF-0087` sent 2 units to the showroom rail, and they were never scanned in.
3. Those open records could account for all 6 units. The recommended next step is to recount before any adjustment is approved.

**Then:**

- Ask **"Why is order ORD-1042 flagged?"** on the Ask your business page.
- Apply a correction and resolve the case. The correction is a new record, the checks re-run, and the audit trail shows who did what.
- Read a new order from a message.
- Ask for a ₹30,000 purchase plan.

**Reset demo data**, in the sidebar, regenerates both businesses as of now.

## How it decides

The spec's rule: the database and deterministic rules own stock, order state and money. The LLM reads messy input and words explanations, and it never decides a quantity, a balance or whether records reconcile.

| Task | Mechanism |
| --- | --- |
| Extract order details | Rules by default ([`src/lib/intake/`](src/lib/intake/)). Optionally Claude reads text, photos or PDFs into a fixed schema whose product codes and colours are enums. Either way the lines go through the same matcher, and a person confirms before anything is reserved. |
| Match a description to a product | An IDF-weighted catalogue matcher. A line that is ambiguous asks the user to choose. An unknown variant is refused rather than invented. |
| Availability and reservations | `post()` in [`src/lib/ops/stock.ts`](src/lib/ops/stock.ts) is the only write path. It uses row locks inside one transaction per order, and `CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand)` makes overselling impossible to store. |
| Sales, margin, stock value | SQL over dispatch records and the ledger. The Measurements page computes each figure two independent ways. |
| Forecast | The 28-day ordered rate, so stockouts don't hide demand. Backtested weekly against a repeat-last-week baseline. |
| Purchasing | Targets cover the lead time plus a 7-day review and 5 safety days. Funding goes in priority order (customers waiting, then running out before a delivery, then below target), best margin per rupee first within each tier. Packs and supplier minimums are enforced, and the budget is a hard limit. Stock under investigation counts as uncertain. |
| Policy questions | Postgres full-text search (`tsvector`, `ts_rank_cd`) over supplier terms and house policies |
| Questions about the business | Each question routes to one of 13 query templates. The database does the arithmetic. |
| Do the records reconcile? | 17 versioned rules ([`src/lib/investigate/`](src/lib/investigate/)) that are never an LLM |
| Explain a case | Built from the findings. Optionally Claude rewords them, and the wording is rejected if it contains a number or record code that isn't in the source records ([`grounding.ts`](src/lib/ai/grounding.ts)). |

### The investigation engine

Rules produce findings, and each finding is one of:

- **Fact:** established from the records.
- **Inference:** what the facts suggest.
- **Unverified hypothesis:** a possible cause, with the evidence that would settle it.

Each finding stores:

- the rule and its version
- the expected and actual values, and the calculation
- the exceptions checked, such as a credit note, a second invoice, a return or a backorder
- the evidence still missing
- links to its source records

**Lifecycle.** A case moves detected → investigating → action required → resolved → closed. The outcomes include record corrected, goods located, adjustment approved, counting error, false positive, legitimate partial fulfilment and awaiting external confirmation.

**Running the checks.**

- The checks re-run after every write and are idempotent.
- A finding that has been resolved doesn't reopen its case.
- A finding that no longer reproduces is marked as such.

**Corrections.** Corrections are compensating records, never edits: a supplementary invoice, a transfer receipt, a putback, a reversal or an approved adjustment. Triggers make the `stock_movements` and `audit_events` tables append-only.

**Permissions.** Roles are owner, warehouse and accounts, and the permissions are enforced in the backend:

- Warehouse staff can't adjust stock or invoice.
- Accounts can't dispatch.
- Only the owner approves adjustments and purchase plans and closes cases.

**Tenants.** Two tenants share the demo, Saffron Thread Apparel and Indigo Lane (an independent brand in Bengaluru). Every query is scoped to the signed-in user's business.

## Measured, not claimed

These figures are from `npm test` on 26 Oct 2026 ([`data/test-report.json`](data/test-report.json)). The in-app Measurements page recomputes most of them live.

| Spec area | Metric | Result |
| --- | --- | --- |
| Order intake | Messages fully right (every line's SKU and quantity) | **42/44**: dev 30/30, holdout 12/14. Ambiguous lines asked 6/6; unknown variants refused 4/4; 2 wrong SKUs chosen |
| Reservations | Duplicate allocations or oversold orders | 0. The simultaneous-orders test passes, and an overselling write is rejected by the database |
| Retrieval | Right policy section ranked first | 10/12 (top 3: 11/12). This set was used while tuning, so it isn't a holdout |
| Analytics | Cross-checks | Balances rebuild from the ledger, except the one planted edit; units shipped and invoice totals agree when computed two ways |
| Forecast | WAPE over 8 weeks | 66% per product-week (baseline 72%), 125% per variant-week (baseline 141%), 38% on total weekly demand; bias −18% |
| Reliability | Tests | 22/22 pass. They cover the demo scenario, ambiguous and unknown orders, insufficient stock, simultaneous orders, missing history, tenant isolation, roles, idempotent checks and the budget limit |

**Holdout history.** The 14 holdout messages were written before the parser rules and kept aside. Their first run scored 11/14. A fix made for a dev case also fixed h14 ("6-6", six each), so the holdout is now 12/14, and h14 is no longer strictly unseen. The two remaining failures are "2 dozen" (h01) and "32 -8" (h06).

**Not measured:**

- Time to locate and pick, which needs timed trials with staff.
- Whether the proposed purchase quantities are useful, which needs owners' feedback.
- The Claude reader's accuracy, which needs a paid evaluation run.

## What's synthetic

Everything is synthetic, and the app says so:

- **Businesses:** two, with users, suppliers (Tiruppur, Ludhiana, Ahmedabad, Kolkata) and twelve retailer customers.
- **Catalogue:** 18 products in about 220 size and colour variants, held in bins across racks.
- **History:** 150 days of orders, picks, dispatches, invoices, payments, returns, transfers, counts and weekly purchasing. It is generated from a fixed seed.
- **Planted discrepancies:** the spec's scenarios plus nine more. The seed test checks that exactly those cases open and no others.

There is no real customer data and no WhatsApp integration: messages are pasted or picked from samples.

## Run it

You need Node 22.18+ (for running `.ts` files directly) and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the website, or http://localhost:3000/login for the demo. The first request creates the database in `./.pglite` and seeds it, which takes a few seconds.

- **Optional Claude features:** copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`. Git ignores `.env.local`. Without a key, every feature works on rules.
- **Checks:** `npm test` runs the 22 tests against an in-memory database, and `npm run test:report` also rewrites `data/test-report.json`. `npm run typecheck`, `npm run lint` and `npm run build` are clean.

## Architecture

```
Next.js pages (src/app/(app))  ─┐
Website (src/app/(site))        │
                                ▼
Route handlers (src/app/api) ── session cookie, tenant scope, zod, role checks; checks re-run after writes
                                │
   ops/  stock, orders, billing, purchasing ── post(): the only stock write path
   investigate/  OrderTrace + StockSleuth rules → engine → cases, corrections, explanations
   intel/  analytics, demand + backtest, plan, alerts, retrieval, assistant
   intake/  rules parser + matcher;  ai/  Claude (structured outputs) + grounding
                                │
PostgreSQL via PGlite (src/db) ── append-only ledger and audit triggers, CHECK constraints
```

- **Framework.** Next.js 16 App Router, React 19, TypeScript and Tailwind CSS v4. `src/proxy.ts` redirects signed-out visitors to `/login`.
- **Look.** Modelled on Medusa's admin dashboard. The colours, shadows and type sizes are adapted from [`@medusajs/ui-preset`](https://github.com/medusajs/medusa/tree/develop/packages/design-system/ui-preset) (MIT). There are light and dark themes.
- **Database.** PostgreSQL run in-process by [PGlite](https://pglite.dev), with plain SQL and no ORM. The schema is in [`src/db/schema.ts`](src/db/schema.ts) and the seed in [`src/seed/`](src/seed/). The same SQL would run on a hosted Postgres.
- **Claude.** Calls go through [`src/lib/ai/claude.ts`](src/lib/ai/claude.ts):
  - model `claude-opus-5-5`
  - structured outputs validated with zod
  - `fallbacks: "default"`, so a request the model's safety checks decline is rerun on a fallback model
  - typed error handling: when Claude fails, the rules' result stays on screen.

## Prior work

| Project | What it does | What RackPilot takes or does differently |
| --- | --- | --- |
| [ERPNext stock reservation](https://docs.frappe.io/erpnext/stock-reservation) | Reserves stock against sales orders and pick lists | Reservations as their own records that can be released, and pick lists built from what is reserved |
| [Medusa Inventory Module](https://docs.medusajs.com/resources/commerce-modules/inventory/concepts) | Stocked and reserved quantity per location; fulfilment consumes the reservation | The same on-hand / reserved / available model, with every change also a ledger row so totals can be rebuilt and checked |
| [Vendure](https://github.com/vendurehq/vendure) | Stock movements of adjustment, allocation, release, sale, cancellation and return | A similar ledger. RackPilot adds transfers, counts and investigations over it |
| [Sift](https://github.com/p-rth12999/Sift), [Chat2Cash / Snapdo](https://github.com/swayam-mishra/snapdo-web), [ChatLedger](https://github.com/tharu200304/ChatLedger) | Turn chat orders into structured records with an LLM and a JSON schema | Schema-constrained extraction for the optional Claude reader. RackPilot keeps rules as the default, measures accuracy on a published test set with a holdout, and connects orders to stock |

## Limitations

- **Sign-in.** It is a demo sign-in with a signed cookie and no passwords. The spec's Supabase Auth isn't wired in; it would sit in front of the same role checks.
- **Claude paths.** Intake, routing and wording were type-checked and exercised without a key. They have not been run against the live API from this machine.
- **Live demo database.** On Vercel the database is in memory per server instance, seeded when the instance starts. Changes last until that instance restarts, and different instances can show different data. A lasting deployment needs a hosted Postgres.
- **Not built yet:** camera barcode scanning (keyboard-wedge scanners and SKU search work), WhatsApp integration, multiple warehouses, and returns to suppliers.
- **Forecast.** Seasonality isn't modelled, because there is under a year of history. Out-of-season products are held back by a rule instead.
- **Intake.** The rules parser still misses "2 dozen" and "32 -8".

## How it was built

It was built by prompting Claude Code running Claude Opus 5.5. The prompts are logged word for word in [`docs/prompts.md`](docs/prompts.md).
