// The whole database, in PostgreSQL. One schema serves RackPilot's core
// operations, OrderTrace and StockSleuth: they read the same orders, stock and
// audit records from different angles.
//
// Conventions
// - Every business-owned row carries business_id; the backend scopes every
//   query by the signed-in user's business.
// - Money is whole rupees (amounts exclude GST). Times are timestamptz.
// - stock_movements and audit_events are append-only: a trigger rejects UPDATE
//   and DELETE, so corrections are new, compensating rows.
// - inventory_balances is the fast, transactionally maintained view of stock
//   per variant and location. StockSleuth reconciles it against the ledger.
// - CHECK constraints stop a balance going negative or reserving more than is
//   on hand, so two orders can't be promised the same units.

/** Bump when the schema changes: a local database with another version is rebuilt and reseeded. */
export const SCHEMA_VERSION = "3";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS businesses (
  id serial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('wholesaler', 'brand', 'retailer')),
  city text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('owner', 'warehouse', 'accounts')),
  title text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS suppliers (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  name text NOT NULL,
  city text NOT NULL,
  lead_time_days int NOT NULL CHECK (lead_time_days > 0),
  moq_units int NOT NULL DEFAULT 0 CHECK (moq_units >= 0),
  pack_size int NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  payment_terms text NOT NULL DEFAULT '',
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS customers (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  name text NOT NULL,
  city text NOT NULL,
  phone text NOT NULL DEFAULT '',
  credit_days int NOT NULL DEFAULT 15,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  name text NOT NULL,
  design text NOT NULL DEFAULT '',
  category text NOT NULL,
  brand text NOT NULL,
  keywords text NOT NULL DEFAULT '',
  supplier_id int NOT NULL REFERENCES suppliers (id),
  unit_cost int NOT NULL CHECK (unit_cost >= 0),
  unit_price int NOT NULL CHECK (unit_price >= 0),
  season text,
  launched_at timestamptz NOT NULL,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS locations (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  warehouse text NOT NULL,
  rack text,
  shelf text,
  bin text,
  kind text NOT NULL CHECK (kind IN ('bin', 'packing', 'receiving', 'quarantine')),
  sellable boolean NOT NULL,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS product_variants (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  product_id int NOT NULL REFERENCES products (id),
  sku text NOT NULL,
  barcode text NOT NULL,
  colour text NOT NULL,
  size text NOT NULL,
  home_location_id int NOT NULL REFERENCES locations (id),
  UNIQUE (business_id, sku),
  UNIQUE (business_id, barcode)
);

CREATE TABLE IF NOT EXISTS inventory_balances (
  business_id int NOT NULL REFERENCES businesses (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  location_id int NOT NULL REFERENCES locations (id),
  on_hand int NOT NULL DEFAULT 0,
  reserved int NOT NULL DEFAULT 0,
  needs_verification boolean NOT NULL DEFAULT false,
  verification_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, location_id),
  CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  location_id int NOT NULL REFERENCES locations (id),
  type text NOT NULL CHECK (type IN ('opening', 'receipt', 'dispatch', 'transfer_out', 'transfer_in', 'customer_return',
                                     'supplier_return', 'damage', 'adjustment')),
  qty int NOT NULL CHECK (qty <> 0),
  ref_type text,
  ref_id int,
  ref_code text,
  actor_user_id int REFERENCES users (id),
  actor_process text,
  reason text,
  reverses_id int REFERENCES stock_movements (id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  customer_id int NOT NULL REFERENCES customers (id),
  channel text NOT NULL CHECK (channel IN ('message', 'voice', 'document', 'manual', 'email')),
  source_text text NOT NULL DEFAULT '',
  extracted_by text NOT NULL DEFAULT 'manual' CHECK (extracted_by IN ('rules', 'claude', 'manual')),
  status text NOT NULL CHECK (status IN ('confirmed', 'picking', 'packed', 'dispatched', 'completed', 'cancelled')),
  due_at timestamptz,
  created_by int REFERENCES users (id),
  created_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  completed_at timestamptz,
  note text,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS order_items (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  order_id int NOT NULL REFERENCES orders (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  qty_ordered int NOT NULL CHECK (qty_ordered > 0),
  qty_cancelled int NOT NULL DEFAULT 0 CHECK (qty_cancelled >= 0),
  backordered boolean NOT NULL DEFAULT false,
  unit_price int NOT NULL CHECK (unit_price >= 0),
  source_text text,
  match_note text,
  CHECK (qty_cancelled <= qty_ordered)
);

CREATE TABLE IF NOT EXISTS reservations (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  order_item_id int NOT NULL REFERENCES order_items (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  location_id int NOT NULL REFERENCES locations (id),
  qty int NOT NULL CHECK (qty > 0),
  status text NOT NULL CHECK (status IN ('active', 'picked', 'consumed', 'released')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  note text
);

CREATE TABLE IF NOT EXISTS pick_lists (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  order_id int NOT NULL REFERENCES orders (id),
  status text NOT NULL CHECK (status IN ('open', 'picked', 'cancelled')),
  created_at timestamptz NOT NULL,
  picked_at timestamptz,
  picked_by int REFERENCES users (id),
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS pick_list_items (
  id serial PRIMARY KEY,
  pick_list_id int NOT NULL REFERENCES pick_lists (id),
  reservation_id int NOT NULL REFERENCES reservations (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  location_id int NOT NULL REFERENCES locations (id),
  qty_to_pick int NOT NULL CHECK (qty_to_pick > 0),
  qty_picked int,
  picked_at timestamptz
);

CREATE TABLE IF NOT EXISTS shipments (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  order_id int NOT NULL REFERENCES orders (id),
  customer_id int NOT NULL REFERENCES customers (id),
  carrier text NOT NULL DEFAULT '',
  tracking text NOT NULL DEFAULT '',
  dispatched_at timestamptz NOT NULL,
  created_by int REFERENCES users (id),
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS shipment_items (
  id serial PRIMARY KEY,
  shipment_id int NOT NULL REFERENCES shipments (id),
  order_item_id int NOT NULL REFERENCES order_items (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  qty int NOT NULL CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS invoices (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
  order_id int NOT NULL REFERENCES orders (id),
  customer_id int NOT NULL REFERENCES customers (id),
  issued_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  created_by int REFERENCES users (id),
  note text,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id serial PRIMARY KEY,
  invoice_id int NOT NULL REFERENCES invoices (id),
  order_item_id int REFERENCES order_items (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  qty int NOT NULL CHECK (qty > 0),
  unit_price int NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receipt', 'refund')),
  customer_id int NOT NULL REFERENCES customers (id),
  invoice_id int REFERENCES invoices (id),
  amount int NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('upi', 'bank', 'cash', 'cheque')),
  reference text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL,
  created_by int REFERENCES users (id),
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS transfers (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  from_location_id int NOT NULL REFERENCES locations (id),
  to_location_id int NOT NULL REFERENCES locations (id),
  status text NOT NULL CHECK (status IN ('sent', 'received', 'cancelled')),
  sent_at timestamptz NOT NULL,
  sent_by int REFERENCES users (id),
  received_at timestamptz,
  received_by int REFERENCES users (id),
  note text,
  UNIQUE (business_id, code),
  CHECK (from_location_id <> to_location_id)
);

CREATE TABLE IF NOT EXISTS transfer_items (
  id serial PRIMARY KEY,
  transfer_id int NOT NULL REFERENCES transfers (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  qty_sent int NOT NULL CHECK (qty_sent > 0),
  qty_received int
);

CREATE TABLE IF NOT EXISTS returns (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  order_id int NOT NULL REFERENCES orders (id),
  customer_id int NOT NULL REFERENCES customers (id),
  received_at timestamptz NOT NULL,
  received_by int REFERENCES users (id),
  note text,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS return_items (
  id serial PRIMARY KEY,
  return_id int NOT NULL REFERENCES returns (id),
  order_item_id int REFERENCES order_items (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  qty int NOT NULL CHECK (qty > 0),
  condition text NOT NULL CHECK (condition IN ('resellable', 'damaged')),
  location_id int REFERENCES locations (id),
  restocked_qty int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  supplier_id int NOT NULL REFERENCES suppliers (id),
  status text NOT NULL CHECK (status IN ('placed', 'partially_received', 'received', 'cancelled')),
  recommendation_id int,
  created_by int REFERENCES users (id),
  placed_at timestamptz NOT NULL,
  expected_at timestamptz NOT NULL,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id serial PRIMARY KEY,
  purchase_order_id int NOT NULL REFERENCES purchase_orders (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  qty int NOT NULL CHECK (qty > 0),
  unit_cost int NOT NULL,
  qty_received int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS receipts (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  purchase_order_id int REFERENCES purchase_orders (id),
  supplier_id int NOT NULL REFERENCES suppliers (id),
  received_at timestamptz NOT NULL,
  received_by int REFERENCES users (id),
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS receipt_items (
  id serial PRIMARY KEY,
  receipt_id int NOT NULL REFERENCES receipts (id),
  purchase_order_item_id int REFERENCES purchase_order_items (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  location_id int NOT NULL REFERENCES locations (id),
  qty int NOT NULL CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS physical_stock_counts (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  scope text NOT NULL DEFAULT '',
  source text NOT NULL CHECK (source IN ('handheld', 'sheet', 'cycle')),
  counted_by int REFERENCES users (id),
  counted_at timestamptz NOT NULL,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id serial PRIMARY KEY,
  count_id int NOT NULL REFERENCES physical_stock_counts (id),
  variant_id int NOT NULL REFERENCES product_variants (id),
  location_id int NOT NULL REFERENCES locations (id),
  recorded_qty int NOT NULL,
  counted_qty int NOT NULL CHECK (counted_qty >= 0)
);

CREATE TABLE IF NOT EXISTS investigations (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  module text NOT NULL CHECK (module IN ('ordertrace', 'stocksleuth', 'both')),
  case_key text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('detected', 'investigating', 'action_required', 'resolved', 'closed')),
  outcome text CHECK (outcome IN ('record_corrected', 'goods_located', 'adjustment_approved', 'counting_error', 'false_positive',
                                  'legitimate_partial_fulfilment', 'awaiting_external_confirmation')),
  priority text NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  assignee_id int REFERENCES users (id),
  subject_type text NOT NULL,
  subject_id int NOT NULL,
  subject_code text NOT NULL,
  detected_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by int REFERENCES users (id),
  resolution_note text,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS investigation_findings (
  id serial PRIMARY KEY,
  investigation_id int NOT NULL REFERENCES investigations (id),
  module text NOT NULL CHECK (module IN ('ordertrace', 'stocksleuth')),
  rule_id text NOT NULL,
  rule_version int NOT NULL,
  fingerprint text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fact', 'inference', 'hypothesis')),
  certainty text NOT NULL CHECK (certainty IN ('verified', 'likely', 'possible')),
  title text NOT NULL,
  detail text NOT NULL,
  expected_value int,
  actual_value int,
  unit text,
  calculation text,
  exceptions_checked jsonb NOT NULL DEFAULT '[]',
  missing_evidence jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('open', 'no_longer_reproduces', 'confirmed', 'dismissed')),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS investigation_evidence (
  id serial PRIMARY KEY,
  investigation_id int NOT NULL REFERENCES investigations (id),
  finding_id int REFERENCES investigation_findings (id),
  record_type text NOT NULL,
  record_id int NOT NULL,
  record_code text NOT NULL,
  label text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS investigation_checks (
  id serial PRIMARY KEY,
  investigation_id int NOT NULL REFERENCES investigations (id),
  position int NOT NULL,
  text text NOT NULL,
  done_by int REFERENCES users (id),
  done_at timestamptz
);

CREATE TABLE IF NOT EXISTS investigation_events (
  id serial PRIMARY KEY,
  investigation_id int NOT NULL REFERENCES investigations (id),
  actor_user_id int REFERENCES users (id),
  actor_process text,
  type text NOT NULL CHECK (type IN ('detected', 'finding', 'status', 'assigned', 'note', 'check', 'correction', 'resolution', 'explanation')),
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  actor_user_id int REFERENCES users (id),
  actor_process text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id int,
  entity_code text,
  reason text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendations (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('purchase_plan')),
  inputs jsonb NOT NULL,
  output jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
  created_by int REFERENCES users (id),
  created_at timestamptz NOT NULL,
  decided_by int REFERENCES users (id),
  decided_at timestamptz,
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS documents (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  supplier_id int REFERENCES suppliers (id),
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('supplier_terms', 'policy')),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses (id),
  document_id int NOT NULL REFERENCES documents (id),
  heading text NOT NULL,
  body text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', heading), 'A') || setweight(to_tsvector('english', body), 'B')) STORED
);

CREATE TABLE IF NOT EXISTS meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE INDEX IF NOT EXISTS movements_by_variant ON stock_movements (variant_id, location_id, created_at);
CREATE INDEX IF NOT EXISTS movements_by_ref ON stock_movements (business_id, ref_type, ref_id);
CREATE INDEX IF NOT EXISTS items_by_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS items_by_variant ON order_items (variant_id);
CREATE INDEX IF NOT EXISTS reservations_by_item ON reservations (order_item_id);
CREATE INDEX IF NOT EXISTS reservations_by_balance ON reservations (variant_id, location_id, status);
CREATE INDEX IF NOT EXISTS orders_by_business ON orders (business_id, created_at);
CREATE INDEX IF NOT EXISTS shipments_by_order ON shipments (order_id);
CREATE INDEX IF NOT EXISTS shipment_items_by_item ON shipment_items (order_item_id);
CREATE INDEX IF NOT EXISTS invoices_by_order ON invoices (order_id);
CREATE INDEX IF NOT EXISTS invoice_items_by_item ON invoice_items (order_item_id);
CREATE INDEX IF NOT EXISTS payments_by_invoice ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS findings_by_case ON investigation_findings (investigation_id);
CREATE INDEX IF NOT EXISTS evidence_by_case ON investigation_evidence (investigation_id);
CREATE INDEX IF NOT EXISTS chunks_fts ON document_chunks USING gin (tsv);

CREATE OR REPLACE FUNCTION rp_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: record a compensating row instead', TG_TABLE_NAME;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_movements_append_only ON stock_movements;
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION rp_append_only();
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION rp_append_only();
`;

/** Every table, children first, for a full reset (TRUNCATE skips the row triggers). */
export const ALL_TABLES = [
  "investigation_events", "investigation_checks", "investigation_evidence", "investigation_findings", "investigations",
  "document_chunks", "documents", "recommendations", "audit_events", "stock_count_lines", "physical_stock_counts",
  "receipt_items", "receipts", "purchase_order_items", "purchase_orders", "return_items", "returns", "transfer_items",
  "transfers", "payments", "invoice_items", "invoices", "shipment_items", "shipments", "pick_list_items", "pick_lists",
  "reservations", "order_items", "orders", "stock_movements", "inventory_balances", "product_variants", "locations",
  "products", "customers", "suppliers", "users", "businesses", "meta",
];

export type Role = "owner" | "warehouse" | "accounts";
export type MovementType =
  | "opening" | "receipt" | "dispatch" | "transfer_out" | "transfer_in" | "customer_return" | "supplier_return" | "damage" | "adjustment";
export type OrderStatus = "confirmed" | "picking" | "packed" | "dispatched" | "completed" | "cancelled";
export type ReservationStatus = "active" | "picked" | "consumed" | "released";
export type InvestigationStatus = "detected" | "investigating" | "action_required" | "resolved" | "closed";
export type Outcome =
  | "record_corrected" | "goods_located" | "adjustment_approved" | "counting_error" | "false_positive"
  | "legitimate_partial_fulfilment" | "awaiting_external_confirmation";
export type Module = "ordertrace" | "stocksleuth";
