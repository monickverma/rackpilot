// Shared types for the rule-based order parser. This folder has no runtime
// dependencies so it runs in the browser, on the server and under plain Node.

export type Size = "S" | "M" | "L" | "XL" | "XXL" | "XXXL" | "FREE";

export type TokenKind =
  | "qty"
  | "each"
  | "unit"
  | "size"
  | "colour"
  | "product"
  | "descriptor"
  | "code"
  | "price"
  | "due"
  | "urgent"
  | "sep"
  | "filler"
  | "unknown";

export interface Token {
  /** Exact slice of the original message. */
  text: string;
  /** Lower-cased, hyphen/apostrophe-free form used for lookups. */
  norm: string;
  start: number;
  end: number;
  kind: TokenKind;
  /** Canonical value: category key, colour, size, number, due label... */
  value?: string | number;
  /** For qty tokens written as "2-2", "ek ek" or "2 each". */
  each?: boolean;
}

export type Attr = "product" | "colour" | "size";

export interface ParsedLine {
  product: string | null;
  colour: string | null;
  size: Size | null;
  qty: number;
  descriptors: string[];
  code: string | null;
  priceHint: number | null;
  /** The part of the message this line came from. */
  sourceText: string;
  span: [number, number];
  /** Attributes copied from an earlier line rather than stated here. */
  inherited: Attr[];
  warnings: string[];
}

export interface DueInfo {
  label: string;
  text: string;
}

export interface ParseResult {
  lines: ParsedLine[];
  tokens: Token[];
  due: DueInfo | null;
  urgent: boolean;
  unknownWords: string[];
  confidence: "high" | "medium" | "low";
}
