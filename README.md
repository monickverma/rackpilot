# RackPilot

RackPilot turns WhatsApp orders into reserved stock and rack pick lists for a small Indian clothing shop. Rules decide the stock, and every number links to the ledger rows behind it.

Hacker House Goa 2026 Wild Card entry.

- **Demo video:** _link to be added_
- **Live demo:** not deployed yet. [Run it locally](#run-it) in two commands.

## The problem

A two-person kurti shop takes most of its orders on WhatsApp, typed the way customers talk:

> Bhaiya 3 black kurti M, 2 L, 1 maroon XL, Saturday tak

The owner reads the message, walks the racks, and keeps the rest in their head:

- Which maroon XL is already promised to someone else?
- Which bestseller will run out before the supplier can deliver?
- How much money is sitting in stock nobody has bought for two months?

General billing and inventory apps can track stock. They don't read Hinglish orders or hold stock against them.

## The 90-second demo

1. **Read the order.** Open **New order** and click Sunita's message. The rules read it into three lines, and each line is matched to a variant and its rack: 3 × K101 black M, 2 × black L and 1 × maroon XL. The due date resolves to Saturday.
2. **Confirm.** Black M and L are reserved. Maroon XL comes up short, and the order says why: the only piece on the rack is held for ORD-1030 (Priya S., due Friday), with a link to that order.
3. **Pick list.** A printable list grouped and sorted by rack (`R1-A1`, …), with the short line listed separately so the customer can be told.
4. **Flags.** Reserving 3 black M leaves 2 free. With 11 sold in the last 30 days, 2 pieces last about 5.5 days, but Jaipur Prints Co. takes 7 days to deliver, so black M is flagged low. The dashboard also lists dead stock (no sale in 60+ days, valued at cost). Post-Navratri chaniya cholis are put on hold instead of being reordered.
5. **Fulfil.** "Mark fulfilled" turns both reservations into sale rows in the ledger. The ledger page shows that every variant's on-hand and reserved counts still rebuild exactly from the ledger rows.

"Reset demo data" in the sidebar regenerates the shop as of now, so the demo can be run again.

## How it decides

The brief set one rule: stock, reservations and recommendations come from code and database queries. An LLM may only parse messy text.

- **One write path.** Every stock change goes through `post()` in [`src/lib/inventory.ts`](src/lib/inventory.ts), inside a SQLite transaction.
  - Each change updates the variant and appends a `stock_movements` row of type receive, reserve, release, sale, adjust or exchange.
  - A `CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand)` makes overselling fail rather than go negative.
- **Free stock** is on hand minus reserved. A line reserves what is free and is marked short for the rest, with the orders holding the remainder named.
- **Low stock.** Days of cover are free stock ÷ (30-day sales ÷ 30). A variant is flagged when cover is shorter than its supplier's lead time: critical below half the lead time, out at zero. Each flag prints its numbers.
- **Dead stock.** The variant has stock on hand, no sale in 60 days, and was first received more than 60 days ago. Leftovers from a season that just ended are listed as season holds instead.
- **Reorder suggestions.** Enough to cover the lead time plus 14 days at the 30-day rate, rounded up to the supplier's size-set packs (for example `S1:M2:L2:XL1:XXL1`). There are no suggestions for a season that has just ended.
- **Matching.** A design code such as K101 if the customer gives one, otherwise the category. Design words ("chikankari", "mirror work"), colour and size then narrow it down. Ties go to the product that sells most, and every match carries a one-line reason. A line that continues the one before ("2 L") keeps the previous product. If the colour or size is missing, the owner picks from the options.

### Optional Claude fallback

When the rules aren't confident about a message, the draft offers **Read with Claude**.

- **What Claude sees.** Only the message text. No stock, prices or customer details.
- **What it returns.** Order lines in a fixed JSON schema (product, colour, size, qty, due date), enforced with structured outputs and validated with zod.
- **What happens next.** Those lines go through the same matcher and reservation code as the rules' lines, and the order is saved as "read by Claude".
- **Configuration.** It runs on the server only, using `claude-opus-5-5` at low effort. If the model's safety checks decline a request, the API reruns it on a fallback model (`fallbacks: "default"`). Errors such as a bad key, rate limits, timeouts, refusals or malformed output become plain messages, and the rules' draft stays on screen.
- **No key.** Without `ANTHROPIC_API_KEY` the button doesn't appear, and the app works fully on rules.

The inbox includes one message the rules misread (Simran's, which pairs every colour with every size) to show the fallback. The fallback has been tested against a local mock of the Messages API only. It has not been run against the live API from this machine.

## Parser accuracy

The rules parser is scored on 50 synthetic WhatsApp orders, each with its expected parse ([`data/parser-testset.json`](data/parser-testset.json)). A message counts only if every line (product, colour, size, quantity) and the due date are exactly right.

| Set | Fully correct |
| --- | --- |
| All | **48/50** (96%) |
| Dev (rules written against these) | 34/34 |
| Holdout (written before the parser, kept aside) | 14/16 |
| English | 11/11 |
| Hinglish | 37/39 |
| Due dates | 12/12 |

There were 101 expected lines: 97 were found, with 95% precision and 96% recall.

**Holdout history.** The holdout's first run scored 13/16 (47/50 overall). Case h06 (`Size M: 2 black`) exposed a real bug: the colon glued words together. Fixing it made the holdout 14/16, so h06 no longer counts as unseen.

The two remaining failures, and the full report, are in [`docs/parser-eval.md`](docs/parser-eval.md). `npm run eval:parser` regenerates it, and the **Parser accuracy** page in the app shows the same run.

## What's synthetic

Everything is synthetic, and the app labels it as such:

- **The shop:** Rang Mahal Garments, Indore.
- **Catalogue:** 40 products and 307 variants on racks R1–R6, shelves A–D.
- **Suppliers:** Jaipur Prints Co. (7-day lead time), Surat Textile Hub (5 days) and Tiruppur Knitwear (14 days), each with a size-set pack.
- **Customers and inbox:** 16 customers and the inbox messages.
- **Sales history:** six months, generated from a fixed seed. It has a Navratri peak, M and L as the best-selling sizes, and a few products that never sell. This comes to about 6,500 ledger rows that rebuild the stock exactly.

There's no real customer data and no WhatsApp integration: messages are pasted, or picked from the simulated inbox.

## Run it

You need npm and Node 22.18+ or 24+. Those versions have the built-in SQLite APIs the app uses and can run the `.ts` scripts directly. It was built and tested on Node 26.7 only.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:3000. The first request creates `local.db` and seeds it.

- **Optional Claude fallback:** copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`. `.env.local` is ignored by git.
- **Checks:** `npm test` runs the end-to-end smoke test of the demo flow and then the parser eval. `npm run typecheck` and `npm run lint` are also clean.

## Architecture

```
WhatsApp text ─► rules parser (src/lib/parser) ─┬─► order lines ─► matcher (src/lib/match.ts) ─► draft
               └─ Claude fallback (optional) ───┘                                         (nothing written)
                                                                                                │ confirm
                                                                                                ▼
             variants + stock_movements ◄── inventory.post(), one transaction per change ◄── orders.ts
                        │
                        └─► insights.ts: low stock, dead stock, reorder, best sellers (queries + pure functions)
```

- **Framework.** Next.js 16 App Router with React 19. Pages are Server Components that stream inside `<Suspense>`, and every write is a Server Action ([`src/app/actions.ts`](src/app/actions.ts)). Styling is Tailwind CSS v4.
- **Look.** Modelled on Medusa's admin dashboard. The colours, shadows and type sizes are adapted from its design system, [`@medusajs/ui-preset`](https://github.com/medusajs/medusa/tree/develop/packages/design-system/ui-preset) (MIT). Light is the default theme, and a dark theme can be picked in the sidebar.
- **Database.** SQLite through Node's built-in `node:sqlite`, with plain SQL: no ORM and no native module to compile. The schema is in [`src/db/schema.ts`](src/db/schema.ts) and the seed in [`src/lib/seed/`](src/lib/seed/).
- **Domain code** ([`src/lib/`](src/lib/)): `inventory.ts` (ledger, stock card, reconciliation), `orders.ts` (draft, confirm, pick, fulfil, cancel), `match.ts`, `insights.ts`, `parser/` (rules), `claude.ts` (fallback).
- **Pages.**
  - Dashboard
  - New order
  - Orders
  - Order detail with its ledger rows
  - Printable pick list
  - Inventory by rack
  - Per-SKU stock card with running balances
  - Ledger with filters and a reconciliation check
  - Parser accuracy

**Why built-in SQLite.** The plan was Drizzle with libSQL. Midway, the disk filled up and npm couldn't install anything, so the app moved to the SQLite that ships with Node. The schema and queries are small enough that plain SQL stayed readable.

## Prior work and what RackPilot borrows

| Project | What it does | What RackPilot takes or does differently |
| --- | --- | --- |
| [ERPNext stock reservation](https://docs.frappe.io/erpnext/stock-reservation) | Reserves stock against sales orders or pick lists (v15+); reservations can be released from the order or cancelled one by one | Reservations as their own records that can be released, and pick lists built from what is reserved |
| [Medusa Inventory Module](https://docs.medusajs.com/resources/commerce-modules/inventory/concepts) | Tracks stocked and reserved quantity per location. Available stock is stocked minus reserved, and [fulfilment](https://docs.medusajs.com/resources/commerce-modules/inventory/inventory-in-flows) consumes the reservation | The same on-hand / reserved / free model. Here every change is also a ledger row, so the totals can be rebuilt and checked |
| [Sift](https://github.com/p-rth12999/Sift) | Turns Hinglish order chats into dispatch tables with small local LLMs (Ollama) and a JSON schema | Schema-constrained extraction for the fallback. RackPilot keeps rules as the default and connects orders to stock, which Sift doesn't track |
| [Chat2Cash](https://devfolio.co/projects/chatcash-9791), now [Snapdo](https://github.com/swayam-mishra/snapdo-web) | WhatsApp order extraction with Claude, JSON-schema prompts and few-shot Hinglish examples, then a human check before invoicing. Its Devfolio page reports about 78% → 94% accuracy in beta, without saying how it was measured. The repo has since been renamed and now holds only the frontend | A human confirms every draft before stock moves. Accuracy is measured on a published test set with a holdout split |

### Similar projects found after the build

A wider search on 26 Oct 2026, after RackPilot was built, turned up these. RackPilot didn't borrow from them, but they are the closest comparisons. Most are small, new repos.

| Project | What it does | How RackPilot compares |
| --- | --- | --- |
| [dukaandaar](https://github.com/chirag120670598-dotcom/dukaandaar) | WhatsApp order bot for Indian shops, with a deterministic Hinglish parser (deliberately not an LLM), GST invoices and UPI payment links | Also rules-first. dukaandaar prices and bills the order; RackPilot reserves sized stock on racks and keeps a ledger behind every count |
| [Parchi](https://github.com/mauryasagar/parchi) | Turns Hinglish WhatsApp orders into an order sheet, totals and a daily prep list for home food sellers. A local Gemma model only reads; Python does the maths, and unclear orders get a Check flag | The same split of work. Parchi plans what to cook; RackPilot holds stock per size and colour and flags what will run out |
| [ChatLedger](https://github.com/tharu200304/ChatLedger) | Turns WhatsApp chat exports into an order sheet for home sellers. The LLM reads intent only, prices and IDs are computed in code, and every field links back to its source message | RackPilot reads with rules first and Claude only as a fallback, and links its stock numbers to ledger rows |
| [IndicOrderBench](https://github.com/Lingikaushikreddy/indicorderbench) | A benchmark and CI gate for English and Hinglish voice ordering agents. It checks the order the agent actually placed, not what it said | RackPilot's parser test is strict in the same way: a message counts only if every line and the due date are exactly right |
| [Vendure](https://github.com/vendurehq/vendure) | Open-source headless commerce. Its stock movements are adjustment, allocation, release, sale, cancellation and return | Nearly the same ledger as RackPilot's receive, reserve, release, sale, adjust and exchange, arrived at separately |

## Limitations

- One shop, no login, and no concurrency control beyond SQLite transactions.
- It isn't deployed. `node:sqlite` needs a persistent disk, so a serverless host would need a hosted SQLite (such as Turso) adapter.
- Messages are pasted. There's no WhatsApp Business API integration.
- The rules parser still misses some patterns. Two holdout cases fail: "M L XL ek ek, kurti mustard" and "dono black M" ("both black M").
- The Claude fallback is verified only against a mock API (see above).
- Saved for later: a budgeted "what should I order with ₹30,000?" plan, purchase orders, and "ask your business" questions answered through fixed query templates.

## How it was built

It was built by prompting Claude Code running Claude Opus 5.5. The prompts are logged word for word in [`docs/prompts.md`](docs/prompts.md).
