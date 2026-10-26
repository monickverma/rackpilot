# RackPilot — Complete Product Specification

Product vision · Core functionality · AI architecture · Business intelligence · Hackathon MVP

RackPilot is an AI-powered operations and business intelligence platform for small clothing wholesalers, independent apparel brands, and clothing retailers. It combines inventory management, order processing, physical stock tracking, fulfilment workflows, sales analytics, and intelligent purchasing recommendations in one system.

The central idea is to help clothing businesses move from manually managing orders, spreadsheets, stockrooms, and purchasing decisions to a unified system that understands their operations and helps them make better decisions.

RackPilot is not just an inventory dashboard or an AI chatbot. It connects the entire business workflow:

Orders arrive

Messages, voice transcripts, manual entry or other supported channels

Inventory and fulfilment

Check stock, reserve items, locate garments and prepare pick lists

Business intelligence

Understand sales, stockouts, slow-moving products and demand

Smarter purchasing decisions

Recommend what to reorder, in what quantity, and why

## 1. The problem RackPilot solves

Small apparel businesses can have several connected operational problems:

- Orders arrive in informal messages rather than structured order-management systems.
- Products have many variants: size, colour, design, SKU and sometimes batch.
- Staff may know that a garment is somewhere in the shop or stockroom but not its exact location.
- Physical stock and recorded stock can diverge.
- Multiple orders may compete for the same remaining units.
- Owners struggle to determine which sizes and designs sell quickly and which are sitting unsold.
- Purchasing decisions may rely on intuition rather than a combined view of sales, available inventory, existing commitments and supplier lead times.

RackPilot is designed to connect these problems instead of treating each one as a separate tool.

These are the problems the product intends to address; their frequency and severity should be validated with actual clothing-business owners before claiming that every target customer experiences them.

## 2. Who the product is for

[Explore Gandhi Nagar Market In Delhi For All Your Shopping Needs](https://images.openai.com/static-rsc-4/E0Xa8gj5n2FxxbZ1IkWMYffqLfzDKjCe90jNxZoh58scEKQMSJlDdQE3MD40jbBxM90wKyg45hetqj7ebnECX9Xj6S3iZY6uMMdXIPQalmsg3t3McA6cysuM4q59qlSG4LTWs-UkHnLurCc4vnNylq1kW9kZMHoNJyesXVA92zo?purpose=inline)

Primary user: Small clothing wholesalers

Businesses handling many garment variants, repeat retailer orders, physical stock and frequent picking and packing.

[Cheerful young female entrepreneur checking and inspecting clothing inventory while holding notebook, managing her online fashion store, preparing merchandise and orders at her home workspace.](https://images.openai.com/static-rsc-4/gn7ZHOMnvBZoEb66CyoeCQvNsy03OzC6l11D3FK0_r9y8ltC2KeObwSci9C6_PYj0ulTmtcRs0UCweO03wxslc6Cku6s6PNrcAwIZlZOhUg7T_s3ywJayKB_YMBeUHwAti9nz1erL6oiF4c1O69ZZIGMZmkfWL2NxF23WJcvU2xDurAgpK1RSpDgkFPhsMFN?purpose=inline)

Secondary user: Independent apparel brands

Brands selling their own designs, managing product variants, monitoring sell-through and deciding which designs to replenish.

[BondEsq | Accounting, Tax & Business Advisory](https://images.openai.com/static-rsc-4/hHSDE6_pV0OezXkiJIDU8UFRhOEP01PaxTPikSXTDvFj6JLI_9zwo2ST260hRn8NBqCsaWnUBoRtnKlhO9732I-RYnUxVcmgEHkXJnU8R4pDgsktygCUqeDmS86rny6btHwzuE-Mxov7W-JC_9Sefvgu1MJksGvn3wsPjA1JKbE?purpose=inline)

Additional potential user: Clothing retailers

Shops that need accurate stock, fast product location, reliable order fulfilment and better purchasing decisions.

The initial target should be narrow: a small clothing wholesaler or independent apparel brand that handles enough orders and inventory for these problems to matter.

## 3. Complete feature breakdown

### A. AI-powered order intake

RackPilot converts unstructured incoming orders into structured, actionable records.

For example, an owner receives this message:

> Bhai, 2 black oversized tees size L, 1 white tee size M. Need everything by tomorrow.

The system extracts the order into structured fields:

| Field              | Extracted value       |
| ------------------ | --------------------- |
| Product            | Oversized T-shirt     |
| Colour             | Black                 |
| Size               | L                     |
| Quantity           | 2                     |
| Second item        | White T-shirt, size M |
| Quantity           | 1                     |
| Requested deadline | Tomorrow              |

The product should support:

- Pasting messages into an order form.
- Parsing voice-note transcripts.
- Extracting order information from suitable uploaded images or documents.
- Matching customer descriptions to existing product variants.
- Identifying missing or ambiguous information.
- Showing a confirmation screen before the order becomes active.

Important: an AI model should not invent a SKU when the requested product cannot be identified confidently. It should ask the user to choose the correct variant.

Integrations with WhatsApp or other messaging platforms would be a later capability unless a working integration is explicitly implemented.

### B. Inventory and SKU management

RackPilot maintains a structured inventory of the garments a business owns.

Each product can have:

- Product name and design.
- SKU or product identifier.
- Category and brand.
- Size and colour variants.
- Unit cost and selling price.
- Current stock quantity.
- Reserved quantity.
- Available quantity.
- Supplier information.
- Sales and stock-movement history.

For example, a single T-shirt design may have separate records for black, white and blue variants, each with sizes S, M, L and XL.

The system must distinguish between:

\\[ \text{Available stock} = \text{On-hand stock} - \text{Reserved stock} \\]

For more advanced workflows, damaged, quarantined or otherwise unavailable items must also be excluded from sellable inventory.

This structured foundation is what allows the order system and analytics engine to use the same trustworthy data.

### C. Physical rack and location tracking

RackPilot connects the digital inventory to the actual physical stockroom.

A garment might be located at:

`Warehouse A → Rack B → Shelf 3 → Bin 12`

Staff can search for a product and receive its recorded location instead of manually searching through shelves.

The system can support:

- Assigning physical locations to products or batches.
- Generating picking instructions by location.
- Moving stock between racks.
- Recording stock adjustments.
- Scanning SKU barcodes or QR codes.
- Flagging items whose recorded location or quantity needs verification.

A camera-assisted feature could help staff identify garment attributes during stock intake. However, visual recognition alone should not be trusted to determine an exact SKU or quantity when errors could cause inventory discrepancies. Barcode scanning and user confirmation provide a more reliable starting point.

### D. Order fulfilment and stock reservations

After an order is confirmed, RackPilot checks whether the required variants are available and creates a fulfilment workflow.

The process is:

1. Validate the requested products and quantities.
2. Check available stock.
3. Reserve the required units.
4. Generate a pick list containing product variants and locations.
5. Track picking and packing status.
6. Record dispatch or completion.
7. Update stock records through controlled transactions.

If two orders compete for the same units, the system should prevent overselling through database-level consistency checks.

If an order cannot be fulfilled, RackPilot should explain the shortage and show possible next steps, such as partial fulfilment or replenishment, without automatically making that decision on behalf of the owner.

### E. Stock alerts and exception management

RackPilot should identify operational problems that require attention rather than forcing owners to inspect every record manually.

Examples include:

- A size or colour variant running low.
- An order that cannot be fully fulfilled.
- Two orders competing for limited stock.
- A product recorded at a location where it cannot be found.
- A shipment deadline approaching with picking incomplete.
- A discrepancy between physical counts and the database.
- Inventory that has remained unsold for a long period.

These alerts should be based on explicit rules and data, with clear explanations of what triggered each alert.

### F. Sales and inventory analytics

This is the first half of the Brand Intelligence functionality.

RackPilot analyses sales and inventory at the level of individual product variants, not just total store revenue.

The owner should be able to understand:

- Best-selling products and designs.
- Fastest-selling sizes and colours.
- Sales trends over time.
- Current stock coverage.
- Low-stock and stockout frequency.
- Slow-moving and ageing inventory.
- Inventory value at cost.
- Gross margin, where reliable cost and sales data are available.
- Outstanding orders and committed stock.

For example, an owner may discover that black T-shirts in size L sell quickly while size S of the same design has remained unsold for several weeks.

That insight can affect the next purchase order.

Analytics must account for missing or incomplete sales data. A product that appears to sell slowly because its sales were never recorded should not automatically be classified as dead stock.

### G. Demand forecasting and replenishment recommendations

This is the second half of Brand Intelligence and potentially the most valuable decision-support capability.

RackPilot estimates which variants are likely to require replenishment and recommends quantities using factors such as:

- Historical sales and recent sales velocity.
- Current physical stock.
- Reserved stock and outstanding orders.
- Supplier lead times.
- Minimum order quantities, where applicable.
- Available purchasing budget.
- Product margins and inventory ageing.
- Seasonality, if enough historical data exists.

The system could use straightforward demand estimates and reorder rules initially, then introduce forecasting models when sufficient data is available.

It should not claim that a prediction is accurate without testing it against historical outcomes.

### H. Budget-aware purchasing intelligence

This is the signature business-intelligence feature I would build around.

The owner asks:

> "I've got ₹30,000 to spend on new inventory. What should I order, and which existing orders could run short?"

RackPilot combines the available inventory, sales history, reservations, margins and supplier lead times to create a proposed purchasing plan.

The output should include:

- Recommended products and variants.
- Suggested quantities.
- Estimated purchase cost.
- Total budget used and remaining.
- Current stock and outstanding commitments.
- Evidence supporting each recommendation.
- Risks and assumptions.
- Products that should not be reordered yet, with reasons.

The owner reviews and approves the proposal before any purchase order is created.

The system should respect hard budget limits, account for supplier constraints when known, and make uncertainty visible. It must not present a generated purchasing suggestion as a guaranteed forecast.

### I. Natural-language business assistant

RackPilot should let owners ask questions using ordinary language rather than navigating multiple reports.

Examples:

- "Which sizes are selling fastest this month?"
- "Show me orders we cannot fulfil with current stock."
- "Which products have been sitting unsold for 45 days?"
- "Why are we running out of black oversized tees?"
- "What would happen if I spent ₹30,000 on replenishment?"
- "Which products should I consider ordering less of?"

The assistant should translate questions into appropriate database queries, calculations or retrieval operations, then explain the results.

For numerical questions, the database and analytics layer should perform the calculations. The language model should explain the results, not invent the numbers.

## 4. The end-to-end business workflow

The main advantage of RackPilot is that the features share the same underlying data.

1. Stock is added

   Products and variants are registered, quantities recorded, and physical rack locations assigned.
2. An order arrives

   AI extracts the requested products, sizes, colours, quantities and deadline.
3. Inventory is checked

   RackPilot matches variants, validates availability and identifies shortages.
4. Stock is reserved

   Confirmed orders reserve inventory so the same units are not allocated twice.
5. Items are picked and dispatched

   Staff use the location-aware pick list and record fulfilment progress.
6. Business performance is updated

   Sales, orders and stock movements feed into inventory and sales analytics.
7. Purchasing recommendations are generated

   RackPilot identifies potential shortages and proposes replenishment quantities based on actual data.

This creates a feedback loop: better order records improve inventory visibility, better inventory visibility improves fulfilment, and better sales records improve purchasing decisions.

## 5. What the AI architecture should actually do

RackPilot should be an AI-enabled business system, not an LLM that controls everything.

| Task                                     | Correct mechanism                                                    |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Extract order details from messages      | LLM with structured output                                           |
| Match a description to a product         | Database search, with AI-assisted matching if needed                 |
| Calculate stock availability             | Database queries and business rules                                  |
| Reserve inventory safely                 | Transactional backend logic                                          |
| Find a garment's recorded location       | Inventory database                                                   |
| Calculate sales and gross margin         | SQL and validated financial calculations                             |
| Forecast demand                          | Statistical or machine-learning models, evaluated on historical data |
| Explain a business result                | LLM grounded in retrieved database results                           |
| Answer questions about supplier policies | RAG over relevant documents                                          |
| Produce a purchasing proposal            | Optimization or rules plus validated business data                   |

RAG is useful for retrieving supplier terms, product documentation and business policies. It is not necessary for every operation, and it should not replace ordinary database queries.

## 6. Proposed technical architecture

Next.js frontend

Inventory, orders, pick lists, analytics and business assistant

Backend API — Node.js / TypeScript

Authentication, validation, permissions and workflow orchestration

PostgreSQL

Products, stock, orders, sales and audit records

AI services

Extraction, matching, explanation and forecasting support

Validated business outputs

Correct stock numbers, traceable recommendations and owner-approved actions

A practical initial stack would be:

- Next.js, TypeScript and Tailwind CSS for the interface.
- Node.js and Next.js API routes for backend workflows.
- PostgreSQL for structured business data.
- Supabase Auth for authentication.
- An LLM API for structured order extraction and explanations.
- SQL aggregations and simple forecasting for analytics.
- Optional pgvector and hybrid search for document retrieval.

The data model would include businesses, users, products, product variants, locations, stock movements, customers, orders, order line items, reservations, sales records, suppliers, purchase orders and recommendation records.

For a multi-business product, every business-owned record must be scoped to the correct tenant, with access controls enforced on the backend.

## 7. What makes RackPilot different?

The individual features are not new. Inventory systems already track SKUs and locations; order-management systems already reserve stock; analytics tools already produce sales reports.

RackPilot's intended differentiation is the integration of these capabilities into a conversational, decision-oriented workflow for small apparel businesses.

Three principles define that positioning:

1. Less manual work: informal orders become structured operational records.
2. Operational accuracy: every order, stock movement and reservation is reflected consistently.
3. Actionable intelligence: sales and inventory data drive traceable recommendations rather than static charts.

The product should not claim to be the first AI inventory system or to eliminate all manual work. Its value must be demonstrated by how much easier and more reliable the target customer's workflow becomes.

## 8. The hackathon MVP versus the full product

The complete vision is larger than what you should attempt in one hackathon.

## Phase 1 — Hackathon MVP

Build first

- A small, realistic clothing catalogue with sizes, colours and rack locations.
- Message-to-order extraction with a confirmation step.
- Inventory availability checks and safe stock reservations.
- Location-aware picking lists.
- Shortage and low-stock alerts.
- One budget-aware replenishment recommendation grounded in sample sales data.
- A clean dashboard showing the complete workflow.

## Phase 2 — Operational maturity

- Barcode or QR-based stock movements.
- Better supplier and purchase-order management.
- Sales and inventory reporting across multiple periods.
- Returns, damaged stock and inventory reconciliation.
- Role-based access and multi-user workflows.
- Tested demand forecasting and configurable reorder rules.

## Phase 3 — Advanced intelligence

- Real messaging-channel integrations.
- Camera-assisted product intake.
- Multiple warehouses and stock transfers.
- Advanced demand forecasting and budget optimization.
- Supplier lead-time learning and seasonal analysis.
- Integrations with existing sales channels and accounting systems.

## 9. How success should be measured

For the hackathon, measure the actual performance of the prototype instead of relying on impressive-looking dashboards.

| Area            | Useful metric                                                           |
| --------------- | ----------------------------------------------------------------------- |
| Order intake    | Accuracy of extracted product variants and quantities                   |
| Inventory       | Difference between recorded and verified physical stock                 |
| Reservations    | Number of duplicate allocations or oversold orders                      |
| Fulfilment      | Time required to locate and pick the required items                     |
| Retrieval       | Whether the correct product and policy information is retrieved         |
| Analytics       | Accuracy of calculated stock, sales and margin figures                  |
| Recommendations | Historical forecast error and usefulness of proposed reorder quantities |
| Reliability     | Rate of successful end-to-end order workflows                           |

You should also test ambiguous orders, unknown product variants, insufficient stock, simultaneous orders and missing sales history.

## 10. The product in one precise definition

RackPilot is a proposed AI-powered operations and business intelligence platform for small clothing wholesalers and independent apparel brands. It converts unstructured orders into structured workflows, manages garment inventory by SKU, size, colour and physical location, coordinates stock reservations and fulfilment, and analyses sales and inventory data to identify risks and recommend replenishment decisions. Its AI layer interprets natural-language inputs and explains recommendations, while a transactional database and deterministic business logic remain responsible for stock accuracy, order state and financial calculations.

The core product thesis: connect what a clothing business sells, what it physically owns, what it has promised customers, and what it should purchase next — in one reliable system.

That is the complete product vision. The first build should demonstrate the central loop of order intake, inventory reservation, fulfilment and evidence-backed replenishment, then expand based on feedback from real clothing-business owners.
