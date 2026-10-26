# RackPilot — Complete Product Specification

You already have the core RackPilot concept: an AI-powered operating system for clothing businesses that manages orders, inventory, stock locations, sales analytics, and purchasing decisions.

The two missing modules — OrderTrace and StockSleuth — turn RackPilot from a normal inventory management system into something more distinctive: a system that can not only manage business operations, but also investigate discrepancies, reconstruct what happened, and show the evidence behind its findings.

Below, I’ve kept RackPilot as the main product and added OrderTrace and StockSleuth as integrated modules, with their own responsibilities, workflows, data requirements, and technical design.

# 1. The complete product

## RackPilot — Core Operations

Manages the day-to-day business: products, variants, inventory, orders, reservations, warehouse locations, picking, dispatch, sales analytics, and purchasing recommendations.

## OrderTrace — Order & Transaction Investigation

Connects customer orders with invoices, payments, stock allocations, and dispatch records. Detects inconsistencies and traces exactly where business records stop agreeing.

## StockSleuth — Inventory Investigation

Investigates missing stock, unexplained quantity changes, incorrect reservations, misplaced items, and inconsistencies between physical counts and recorded inventory.

The product has three connected responsibilities:

- Operate: manage the business's orders and inventory.
- Investigate: identify discrepancies and reconstruct the sequence of events that caused them.
- Optimize: use the resulting operational and sales data to make better stock and purchasing decisions.

The important part is that these are not three unrelated applications. They share one data model and one history of business events.

# 2. OrderTrace — detailed specification

## What problem does OrderTrace solve?

A clothing wholesaler might receive an order through WhatsApp, prepare the stock, generate an invoice, receive a payment, and dispatch the goods using separate tools or manual records.

Each record may look reasonable on its own, but the records can disagree.

For example:

- The customer ordered 20 shirts.
- The warehouse allocated 20 shirts.
- The invoice billed for 18 shirts.
- The dispatch record says 20 shirts were shipped.
- The customer paid the invoice amount for 18 shirts.

A conventional dashboard may show the order as completed, or an employee may have to compare several records manually.

OrderTrace connects those records, detects the mismatch, and produces an evidence-backed explanation of where the transaction diverged.

Its job is not simply to flag that two numbers are different. It is to establish what was expected, what was recorded at each stage, which records support the finding, and what still needs human verification.

## 2.1 The records OrderTrace connects

### 1

Customer order

What the customer requested: product, size, colour, quantity and agreed price.

### 2

Stock allocation

What inventory was reserved or picked to fulfil that order.

### 3

Invoice

What the business billed the customer for.

### 4

Payment

What was received, when it was received, and which invoice it applies to.

### 5

Dispatch / shipment

What the warehouse recorded as packed, shipped or delivered.

OrderTrace links these records using order IDs, invoice IDs, shipment references, customer IDs, product variant IDs, and explicit relationships between records. When a business has only spreadsheets, PDFs, or message-based orders, the system can help import and structure those records before reconciling them.

It must also handle legitimate exceptions. One order can have several invoices, partial payments, backorders, and multiple shipments. A difference is not automatically proof of an error.

## 2.2 Example: the missing two shirts

Imagine a wholesale customer orders 20 blue shirts in size M.

Customer order

## 20 units

Stock allocated

## 20 units

Invoice quantity

## 18 units

Dispatch record

## 20 units

Unreconciled quantity

# 2 units

Illustrative example — the system would calculate these values from the actual records.

OrderTrace would work through the discrepancy as follows:

1. Match the records. Confirm that the order, allocation, invoice and dispatch concern the same customer and the same shirt variant.
2. Compare quantities. Check the expected quantity at each stage, accounting for partial fulfilments, cancellations, returns and other valid adjustments.
3. Locate the divergence. Identify that the invoice records 18 units while the dispatch record records 20.
4. Check related evidence. Look for another invoice, a credit note, a replacement shipment, a packing correction or an authorised adjustment that could explain the difference.
5. Create an investigation. Show the mismatch, the relevant records, the calculations, the timeline and the possible explanations.
6. Route it for resolution. Let an authorised employee confirm the cause, correct the appropriate record, or mark the discrepancy as legitimate.

The system must not automatically conclude that someone stole two shirts. The evidence establishes a mismatch, not necessarily its cause.

## 2.3 What the OrderTrace investigation screen should show

## Investigation OT-001

Needs review

Order ORD-1042 · Blue shirt / Size M

### Finding: quantity mismatch

# 2 units

Dispatch quantity exceeds invoiced quantity by two units.

### Evidence trail

1. 10:04 — Order created\


   20 units requested by the customer.
2. 10:15 — Stock allocated\


   20 units reserved against the order.
3. 11:02 — Invoice recorded\


   Invoice INV-2058 lists 18 units.
4. 11:20 — Dispatch recorded\


   Shipment SHP-501 lists 20 units.

### Next action

Verify the invoice and packing records, then assign the investigation to the responsible employee.

This is a conceptual mock-up, not a report generated from real business data.

A useful investigation view should include:

- A clear description of the discrepancy.
- Expected and recorded values.
- Direct links to the source records.
- A chronological event timeline.
- The rule that triggered the finding.
- Possible explanations and missing evidence.
- An owner, status, notes, and resolution history.
- An audit trail of who changed what and when.

## 2.4 OrderTrace detection rules

For the first version, implement explicit, deterministic reconciliation rules rather than asking an LLM to decide whether transactions are correct.

| Rule                        | What it detects                                                            |
| --------------------------- | -------------------------------------------------------------------------- |
| Order vs invoice            | Unbilled quantities, overbilling, or unexpected line items                 |
| Order vs dispatch           | Quantities recorded as shipped that do not match the fulfilment plan       |
| Invoice vs payment          | Outstanding balances, overpayments, and unallocated payments               |
| Allocation vs dispatch      | Reserved or picked quantities that differ from dispatched quantities       |
| Duplicate records           | Potential duplicate invoices, payments, or shipments                       |
| Customer / product mismatch | A linked record references the wrong customer or product variant           |
| Unexplained status          | An order marked complete when required fulfilment steps remain outstanding |

Every rule must understand valid exceptions. For example, an invoice for 18 units against a 20-unit order may be perfectly correct if the remaining two units are backordered and will be invoiced later.

## 2.5 How AI fits into OrderTrace

AI is useful for:

- Extracting invoice numbers, customer names, quantities, prices and dates from PDFs, images, or pasted text.
- Converting message-based orders into structured line items.
- Suggesting possible matches when two systems use different reference numbers.
- Summarising an investigation in plain English.
- Helping an employee ask questions such as, “Why is this order still unresolved?”

But the AI should not be the authority that determines the financial discrepancy.

The application should use database records, explicit matching rules, arithmetic and validated business logic to calculate discrepancies. The AI can explain those results and suggest where to look next. Any uncertain record match should be shown as uncertain and require confirmation.

## 2.6 What makes OrderTrace useful?

The value is reducing the time needed to investigate problems that otherwise require employees to cross-check messages, spreadsheets, invoices, payment records and dispatch notes.

Its output is an actionable investigation rather than just another dashboard alert.

It becomes especially useful when a business has enough transaction volume that manual reconciliation is time-consuming, but lacks an integrated enterprise system.

# 3. StockSleuth — detailed specification

## What problem does StockSleuth solve?

A clothing business's recorded stock can differ from the stock employees can actually find.

For example, the system says there are 50 medium-sized black T-shirts, but the warehouse count finds only 44.

That discrepancy could be caused by:

- An order being picked without the inventory record being updated.
- A reservation being recorded incorrectly.
- A stock transfer between racks never being logged.
- A return being received physically but not entered into the system.
- A damaged item being removed without a corresponding adjustment.
- A duplicate or incorrect inventory adjustment.
- Goods being placed in the wrong location.
- A counting error.

StockSleuth investigates the stock history to narrow down what happened.

Its purpose is to explain how recorded inventory reached its current state, identify the earliest point where the evidence stops reconciling, and guide an employee toward a verified resolution.

## 3.1 The stock data it needs

StockSleuth depends on RackPilot maintaining a trustworthy inventory movement history.

For each product variant — for example, Black T-shirt, size M — it should track:

- Opening quantity.
- Purchases and goods received.
- Sales and dispatches.
- Reservations and releases.
- Transfers between racks or warehouse locations.
- Customer returns and supplier returns.
- Damaged, lost or written-off items.
- Manual adjustments.
- Physical stock counts.
- The employee or process responsible for each recorded event.
- Timestamps and references to the related order, receipt, transfer or investigation.

The central principle is that the application should not merely overwrite the quantity and forget how it got there. It should preserve an append-only record of stock movements and adjustments, with corrections represented as new, auditable events.

A current stock quantity can then be derived from the opening balance and relevant movements, with reservations tracked separately.

## 3.2 Example: six shirts have gone missing

Suppose RackPilot records 50 black T-shirts in size M, but a physical count finds 44.

Recorded on-hand stock

## 50

Physical count

## 44

Unexplained variance

# −6 units

Illustrative example — the variance is a discrepancy, not proof of theft.

StockSleuth starts by confirming that the comparison uses the same SKU, size, colour, location and counting time.

It then reconstructs the stock history. For example:

### Stock movement history

09:00 — Stock received

Opening quantity plus delivery

### 50 units

10:15 — Order picked

Pick list records 4 units

### −4

The system must check whether picking should reduce on-hand stock or only move it into a picked/packed state.

11:30 — Location transfer

Transfer out recorded

### −2

No corresponding transfer-in record found at the destination.

14:00 — Physical count

Counted on the shelf

### 44 units

This is a conceptual example, not a verified stock ledger. The events shown would need to reconcile to the recorded quantity before the system could identify a likely cause.

StockSleuth should investigate whether the four picked units were correctly accounted for and whether the two transferred units arrived at their destination. It should not simply assume that these events explain the full six-unit difference.

## 3.3 StockSleuth investigation workflow

1. Detect or receive the discrepancy. A scheduled consistency check, employee-entered physical count, or inventory alert identifies a variance.
2. Validate the comparison. Confirm the SKU, size, colour, warehouse location and stock-count timestamp.
3. Reconstruct the ledger. Replay relevant stock movements from the last trusted balance to the current state.
4. Check related transactions. Examine orders, reservations, pick lists, dispatches, returns, purchase receipts, transfers and manual adjustments.
5. Identify suspicious gaps. Find missing movement pairs, duplicate entries, unexpected negative stock, stale reservations or unexplained adjustments.
6. Rank evidence-backed explanations. Show which events could explain the variance, why they are relevant, and what evidence is still missing.
7. Resolve with human verification. Let an authorised employee recount, locate the goods, correct the records, or approve a documented stock adjustment.
8. Preserve the outcome. Record the final explanation, supporting evidence, approved adjustment and responsible employee.

The system can identify the most plausible explanation based on the available evidence. It cannot reliably infer a person's intent or prove that physical goods were stolen from software logs alone.

## 3.4 What the StockSleuth screen should show

## Investigation SS-004

Open

SKU BLK-TSH-M · Warehouse A · Rack R-12

Stock variance

# −6 units

Recorded: 50 · Counted: 44

### Potential findings

Transfer may be incomplete

A transfer-out record exists, but no matching transfer-in record was found. Verify the destination rack and transfer paperwork.

Pick operation needs reconciliation

Compare the pick list with dispatch records to establish whether the picked items were shipped, returned to stock, or left in a packing area.

### Recommended next step

Recount Rack R-12 and check the destination of the two transferred units before approving any adjustment.

The screen should make it easy to answer three questions:

- What is wrong?
- What evidence might explain it?
- What should the employee check or do next?

## 3.5 StockSleuth detection rules

| Rule                       | What it identifies                                                               |
| -------------------------- | -------------------------------------------------------------------------------- |
| Physical vs recorded stock | A difference between a count and the expected on-hand quantity                   |
| Transfer imbalance         | Stock leaving one location without being received at another                     |
| Duplicate movement         | The same receipt, transfer or adjustment potentially being recorded twice        |
| Negative inventory         | Transactions producing an impossible or suspicious stock balance                 |
| Stale reservations         | Stock held for cancelled, expired or completed orders                            |
| Pick vs dispatch           | Goods marked picked but not accounted for in subsequent fulfilment states        |
| Return reconciliation      | Returned goods physically received but not correctly restored to available stock |
| Adjustment anomalies       | Unusually large or repeated manual adjustments requiring review                  |
| Location mismatch          | Stock assigned to one rack but found or transferred elsewhere                    |
| Ledger inconsistency       | The movement history does not reconcile with the stored inventory balance        |

These checks are not all equally certain. A missing transfer-in record is evidence of an incomplete record; it does not establish whether the goods were lost, misplaced, or simply not entered yet.

## 3.6 How AI fits into StockSleuth

AI can help by:

- Extracting quantities and product details from physical-count sheets or delivery notes.
- Matching imperfectly labelled records to candidate SKUs.
- Summarising long stock-movement histories.
- Explaining a discrepancy in ordinary language.
- Suggesting the next records or physical locations to inspect.

However, stock balances, movement calculations, reservation states and anomaly rules should be handled by deterministic application logic. AI-generated explanations must link back to actual events, and uncertain matches must remain explicitly uncertain.

# 4. How OrderTrace and StockSleuth work together

This is the most important architectural connection.

OrderTrace investigates discrepancies across business transactions. StockSleuth investigates discrepancies in physical and recorded inventory. They use the same underlying order, stock, shipment and audit data.

Consider a customer who claims that an order was short-shipped.

- OrderTrace compares the order, invoice, payment and dispatch records.
- StockSleuth checks the picking history, warehouse movements, reservations and physical count.
- RackPilot supplies the original order and inventory records and updates the operational state after an authorised resolution.

The modules can share a single investigation record, with separate findings for transaction reconciliation and stock reconciliation.

## RackPilot data foundation

Orders · Products · Inventory · Locations · Payments · Shipments · Stock movements

OrderTrace

Finds mismatches between commercial records.

StockSleuth

Finds mismatches between stock records and movements.

## Unified Investigation Centre

Evidence · Timeline · Findings · Assigned owner · Resolution · Audit history

For example, OrderTrace may find that 20 units were invoiced but only 18 were recorded as dispatched. StockSleuth can then examine whether the remaining two units are still in the warehouse, were never picked, were transferred to another location, or have an incomplete movement history.

Neither module needs to independently recreate the entire transaction history. They query and interpret the same underlying records from different perspectives.

# 5. The shared investigation engine

Rather than implementing two unrelated anomaly systems, build a shared engine that both modules use.

Its responsibilities should be:

1. Receive a discrepancy from a rule or employee.
2. Identify the affected business entities and records.
3. Retrieve relevant events and source documents.
4. Run the applicable reconciliation rules.
5. Record findings with supporting evidence.
6. Track the investigation's status and owner.
7. Record the verified resolution and any authorised corrections.

A finding should contain the rule that triggered it, the affected entities, the expected and actual values, the evidence references, the calculation, the confidence or certainty of the finding, and the resolution state.

A useful distinction is:

- Fact: the invoice lists 18 units and the dispatch record lists 20.
- Inference: the transaction may have an invoicing discrepancy.
- Unverified hypothesis: the invoice may be missing a line item.
- Resolution: an authorised employee confirms the correct quantity and records the necessary correction.

Keeping these categories separate makes the product more trustworthy.

## Recommended investigation lifecycle

1

Detected

A rule flags a discrepancy.

2

Investigating

Evidence is collected and reviewed.

3

Action required

A human must verify or correct something.

4

Resolved

The cause and outcome are documented.

5

Closed

The authorised resolution is complete.

You should also support outcomes such as false positive, legitimate partial fulfilment, counting error, and awaiting external confirmation. Otherwise, the system will keep treating normal business exceptions as unresolved errors.

# 6. Shared database design

These modules should extend RackPilot's core schema rather than operate on separate databases.

| Entity / table                 | Purpose                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `products`                     | Product identity, name and category                      |
| `product_variants`             | SKU-level identity, size, colour and other variants      |
| `locations`                    | Warehouse, room, rack, shelf or storage location         |
| `inventory_balances`           | Current on-hand stock by variant and location            |
| `stock_movements`              | Receipts, dispatches, transfers, returns and adjustments |
| `orders`                       | Customer orders and their operational status             |
| `order_items`                  | Product variants, quantities and agreed prices           |
| `reservations`                 | Quantities committed to orders but not yet dispatched    |
| `invoices` / `invoice_items`   | Amounts and quantities billed                            |
| `payments`                     | Receipts, refunds and payment allocations                |
| `shipments` / `shipment_items` | Dispatch and fulfilment records                          |
| `purchase_orders` / `receipts` | Supplier orders and goods received                       |
| `physical_stock_counts`        | Count sessions and observed quantities                   |
| `investigations`               | Shared investigation case, owner and lifecycle           |
| `investigation_findings`       | Individual discrepancies and hypotheses                  |
| `investigation_evidence`       | References to source records and supporting calculations |
| `audit_events`                 | Who changed what, when, and through which action         |

### Important implementation details

Inventory ledger: Store each stock movement as an immutable event, or preserve it in a sufficiently auditable ledger. Corrections should be represented by reversing or compensating movements rather than silently rewriting the history.

Current balances: Keep a materialised or transactionally maintained balance for fast stock checks, but reconcile it against the ledger.

Reservations: Keep reserved quantities distinct from on-hand quantities. Available-to-promise stock is typically on-hand stock minus active reservations, subject to the business's fulfilment rules.

Record relationships: Link each invoice, shipment, payment and stock movement to the relevant order or source record. Support partial fulfilments and split invoices.

Auditability: Record the actor, timestamp, reason and reference for changes, and apply appropriate permissions for financial and inventory adjustments.

Evidence integrity: Store the source record ID, relevant values and rule version used to produce each finding. If a source record later changes, preserve enough history to explain why the original finding was created.

# 7. How RackPilot's AI and analytics fit around the two modules

OrderTrace and StockSleuth are not replacements for the existing RackPilot features. They use the same operational data to make those features safer and more useful.

| RackPilot capability              | How the investigation modules contribute                                        |
| --------------------------------- | ------------------------------------------------------------------------------- |
| Message-to-order extraction       | Creates structured orders that OrderTrace can reconcile                         |
| Inventory management              | Supplies the stock ledger and balances StockSleuth investigates                 |
| Picking and dispatch              | Supplies fulfilment events used by both modules                                 |
| Sales analytics                   | Can exclude or flag unresolved transactions in selected reports                 |
| Stock alerts                      | Can distinguish low stock from a potentially unreliable recorded balance        |
| Purchasing recommendations        | Can account for stock that is damaged, missing, reserved or under investigation |
| Natural-language business queries | Can explain a finding using verified database records                           |
| Supplier and customer records     | Provide context for investigating transaction discrepancies                     |

For purchasing intelligence, be careful not to double-count inventory. A stock discrepancy should not automatically be treated as a confirmed shortage. The product should distinguish verified available stock from uncertain or under-investigation stock and make the effect on purchasing recommendations explicit.

# 8. The end-to-end user experience

The user should not need to understand three separate products. They should use one RackPilot interface with different work areas.

[Low-code applications for Manufacturing | Retool](https://images.openai.com/static-rsc-4/HbIS5TPvWTGU1haIgpqUAreFX5sO6yDdVn_X1tHD7EXUcOyelwTc-O5mJxcYXySlVPmHZ6fk1tLogeqBYMyIU9c-6mOeUDJTglzkYc4OfQk4m3GUNYs7HT7tiuAzXQODnLEqwd9s6i8EYP9mul5rX29T0M1z3gGak17XjEnAQc0?purpose=inline)

1\. Operations dashboard

Overview of orders, stock, pending dispatches, low-stock items, and outstanding investigations.

[ReconcileAI – AI-Powered Finance Operations for Growing Businesses](https://images.openai.com/static-rsc-4/0YuZ-PN_2Z1KPc7JvppeXzUPRHq6lOZr7kkyNOaIFujju2DQ1U10oR_V89c2Qb2wbZVpm_LZmH8kXVJgKaFwlLXQZ6ezerm1kYhiOJbc4AFzsFN8bVz2wTM_oIwhcKQICWdjg8_7Rs2WLNdTor4a2fCLnV8GRui4NftquIwo_Dc?purpose=inline)

2\. OrderTrace

Search transactions, compare linked records, review mismatches, and resolve commercial discrepancies.

[Inventory management UI for warehouse accuracy and visibility](https://images.openai.com/static-rsc-4/kwIE810s84U5OOyx4_CNmUQPAHGH64I12JGFTbnSBHNQ9TbH7kmf7tIm7KL1fyz4_OsYVceK4XLbVkiB_IZ4lQAOU3z-BU6AgT1UTvDjqgRM_E3TGNdYZdVGqt8p4zaatdBWyQGz3zN2fgk5kLY_hbT85IFwFO0EQ5XdHBuWdyE?purpose=inline)

3\. StockSleuth

Review stock variances, reconstruct movements, inspect rack locations, and document corrections.

4\. Investigation Centre

One queue for open cases, evidence, assigned employees, priorities, resolution notes, and audit history.

These images are visual references for the intended interface, not screenshots of an existing implementation.

# 9. What to build for the hackathon

The full product is a broad vision. Trying to implement every inventory, financial, analytics and AI feature at once is likely to make the result less convincing.

I would build a single end-to-end discrepancy investigation that demonstrates both modules working together.

## Recommended MVP

1. Core inventory and orders

   Create clothing products with size and colour variants, rack locations, orders, stock movements, reservations and dispatch records.
2. OrderTrace rule

   Detect a mismatch between order quantity, invoice quantity and dispatch quantity, with support for partial fulfilments.
3. StockSleuth rule

   Detect a physical-count variance and identify a missing or inconsistent stock movement.
4. Shared investigation screen

   Show the finding, timeline, source records, calculation, suggested checks, assignment and resolution history.
5. One AI feature

   Let an employee ask, “Why is order ORD-1042 flagged?” Generate a concise explanation grounded in the records already retrieved by the application.
6. One operational outcome

   Allow an authorised employee to document a verified correction, update the relevant business state, and preserve an audit trail.

### A compelling demo scenario

1. Import a small clothing catalogue and a set of sample orders.
2. Receive stock and record its location.
3. Create an order for 20 shirts.
4. Introduce an invoice discrepancy: only 18 units are billed.
5. Introduce a stock movement discrepancy: a transfer-out record has no matching transfer-in.
6. Open the Investigation Centre and show the OrderTrace and StockSleuth findings.
7. Ask the AI why the case was flagged.
8. Follow the evidence to the relevant records, verify the actual situation, and record the resolution.

This tells a coherent story: RackPilot manages the operation, detects that something is wrong, investigates the evidence, and helps an employee resolve the issue.

# 10. Final product definition

RackPilot is an AI-assisted operations and business-intelligence platform for small clothing wholesalers and apparel businesses. It manages orders, stock, warehouse locations, fulfilment, sales analysis and purchasing decisions. Its integrated OrderTrace module reconciles orders, invoices, payments and dispatch records to uncover transaction discrepancies. Its StockSleuth module reconstructs inventory movements to investigate stock variances, missing movement records, incorrect reservations and location inconsistencies. Both modules share a unified investigation engine that presents source-linked evidence, distinguishes verified facts from hypotheses, recommends checks, and records authorised resolutions.

The differentiation is not simply that it uses AI or that it manages clothing inventory. Inventory management and reconciliation tools already exist. The more specific product proposition is:

RackPilot connects everyday clothing-business operations with evidence-backed investigations into why recorded transactions and stock do not reconcile.

That is the part I would make the centrepiece of the hackathon demo.
