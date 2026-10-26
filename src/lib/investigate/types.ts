// The shape every OrderTrace and StockSleuth rule produces. A rule never
// writes; it returns drafts, and the engine decides whether each one opens a
// case, joins an open case, or was already resolved by a person.

export type Kind = "fact" | "inference" | "hypothesis";
export type Certainty = "verified" | "likely" | "possible";
export type Priority = "high" | "medium" | "low";

export interface EvidenceRef {
  type: string;
  id: number;
  code: string;
  label: string;
  detail: string;
  at: Date;
  values?: Record<string, string | number | null>;
}

export interface Draft {
  /** Which case this finding belongs to: order:<id>, stock:<variant>:<location> or payment:<id>. */
  caseKey: string;
  subject: { type: string; id: number; code: string };
  module: "ordertrace" | "stocksleuth";
  rule: string;
  version: number;
  /** Same fingerprint means the same finding with the same numbers. */
  fingerprint: string;
  kind: Kind;
  certainty: Certainty;
  title: string;
  detail: string;
  expected?: number | null;
  actual?: number | null;
  unit?: string;
  calculation?: string;
  exceptions?: string[];
  missing?: string[];
  evidence: EvidenceRef[];
  checks?: string[];
  /** When the discrepancy became detectable. */
  at: Date;
  priority: Priority;
  /**
   * Context findings (the other module's view of the same records) only join
   * a case that a primary finding opened; they never open one on their own.
   */
  context?: boolean;
  /** Orders findings within a case: lower first. */
  rank: number;
  /** Title for the case when this finding leads it. */
  caseTitle?: string;
}

export const RULES: Record<string, { module: "ordertrace" | "stocksleuth"; name: string; detects: string }> = {
  "OT-INV": { module: "ordertrace", name: "Order vs invoice", detects: "Dispatched quantities not billed, billing ahead of dispatch, or invoice lines the order doesn't have" },
  "OT-SHP": { module: "ordertrace", name: "Order vs dispatch", detects: "More shipped than the order allows after cancellations" },
  "OT-PAY": { module: "ordertrace", name: "Invoice vs payment", detects: "Overpayments, balances more than 30 days past due, and payments not allocated to an invoice" },
  "OT-ALLOC": { module: "ordertrace", name: "Allocation vs dispatch", detects: "Picked or reserved units left behind once an order is dispatched or closed" },
  "OT-DUP": { module: "ordertrace", name: "Duplicate records", detects: "Payments, invoices or shipments that look recorded twice" },
  "OT-MATCH": { module: "ordertrace", name: "Customer / product mismatch", detects: "A linked shipment, invoice or payment naming a different customer or variant than the order" },
  "OT-STATUS": { module: "ordertrace", name: "Unexplained status", detects: "An order marked complete while fulfilment, billing or payment is outstanding" },
  "SS-COUNT": { module: "stocksleuth", name: "Physical vs recorded stock", detects: "A count that differs from the recorded on-hand quantity at that time" },
  "SS-TRF": { module: "stocksleuth", name: "Transfer imbalance", detects: "Stock sent from one location and not received at the other" },
  "SS-DUP": { module: "stocksleuth", name: "Duplicate movement", detects: "The same receipt, transfer or adjustment posted twice" },
  "SS-NEG": { module: "stocksleuth", name: "Negative inventory", detects: "Movements that, replayed in time order, take a balance below zero" },
  "SS-STALE": { module: "stocksleuth", name: "Stale reservations", detects: "Stock still held for orders that are cancelled or already closed" },
  "SS-PICK": { module: "stocksleuth", name: "Pick vs dispatch", detects: "Units marked picked that were neither dispatched nor put back" },
  "SS-RET": { module: "stocksleuth", name: "Return reconciliation", detects: "Resellable returns received but not restocked" },
  "SS-ADJ": { module: "stocksleuth", name: "Adjustment anomalies", detects: "Repeated or large manual adjustments with no count behind them" },
  "SS-LOC": { module: "stocksleuth", name: "Location mismatch", detects: "Stock counted at a location where none is recorded" },
  "SS-LEDGER": { module: "stocksleuth", name: "Ledger inconsistency", detects: "A stored balance that no longer equals its movement history or its reservations" },
};
