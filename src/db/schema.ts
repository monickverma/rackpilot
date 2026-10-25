// The whole database. Money is whole rupees, times are epoch milliseconds.
//
// variants.on_hand and variants.reserved are a running total of
// stock_movements: every write changes both in one transaction, and the CHECK
// stops stock going negative or more being reserved than is on the rack.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  lead_time_days INTEGER NOT NULL CHECK (lead_time_days > 0),
  pack_ratio TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  supplier_id INTEGER NOT NULL REFERENCES suppliers (id),
  cost_price INTEGER NOT NULL,
  sell_price INTEGER NOT NULL,
  season TEXT
);

CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id),
  sku TEXT NOT NULL UNIQUE,
  colour TEXT NOT NULL,
  size TEXT NOT NULL,
  location TEXT NOT NULL,
  on_hand INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  raw_message TEXT NOT NULL,
  parser TEXT NOT NULL DEFAULT 'rules',
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'fulfilled', 'cancelled')),
  due_label TEXT,
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id),
  variant_id INTEGER REFERENCES variants (id),
  source_text TEXT NOT NULL,
  qty_requested INTEGER NOT NULL CHECK (qty_requested > 0),
  qty_reserved INTEGER NOT NULL DEFAULT 0,
  qty_fulfilled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'short', 'unmatched', 'fulfilled', 'released')),
  match_note TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES variants (id),
  type TEXT NOT NULL CHECK (type IN ('receive', 'reserve', 'release', 'sale', 'adjust', 'exchange')),
  qty INTEGER NOT NULL CHECK (qty > 0),
  on_hand_delta INTEGER NOT NULL,
  reserved_delta INTEGER NOT NULL,
  order_id INTEGER REFERENCES orders (id),
  ref TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS movements_by_variant ON stock_movements (variant_id, created_at);
CREATE INDEX IF NOT EXISTS movements_by_order ON stock_movements (order_id);
CREATE INDEX IF NOT EXISTS movements_by_type ON stock_movements (type, created_at);
CREATE INDEX IF NOT EXISTS lines_by_order ON order_lines (order_id);
CREATE INDEX IF NOT EXISTS lines_by_variant ON order_lines (variant_id, status);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const TABLES_IN_DELETE_ORDER = ["stock_movements", "order_lines", "orders", "variants", "products", "suppliers", "meta"];

export type MovementType = "receive" | "reserve" | "release" | "sale" | "adjust" | "exchange";
export type OrderStatus = "confirmed" | "fulfilled" | "cancelled";
export type LineStatus = "reserved" | "short" | "unmatched" | "fulfilled" | "released";
