// Checks that generated wording stays inside the records it was given: every
// number it states must appear in the source data, and every record code it
// cites must be one of the source records. A reply that fails is not shown;
// the deterministic explanation is shown instead, with the reason.

const NUMBER = /(?<![A-Z0-9-])(?:₹\s?)?\d[\d,]*(?:\.\d+)?%?/g;
const CODE = /\b(?:ORD|INV|CN|SHP|PAY|RFD|PL|TRF|PO|GRN|RET|CNT|OT|SS|PLAN)-\d{2,5}\b|\b[A-Z]{3}-[A-Z]{3}-(?:XXL|XL|[SML]|\d{2})\b|\bA-[A-Z0-9]+(?:-S\d+-B\d+)?\b/g;

const norm = (s: string) => s.replace(/[₹,%\s]/g, "");

export interface GroundingCheck {
  ok: boolean;
  unsupportedNumbers: string[];
  unknownCodes: string[];
}

/** Numbers and codes present in the source, as strings (both "1,240" and "1240" forms). */
function sourceTokens(source: unknown) {
  const text = JSON.stringify(source);
  const numbers = new Set<string>();
  for (const m of text.match(/-?\d+(?:\.\d+)?/g) ?? []) {
    numbers.add(m.replace(/^-/, ""));
    const n = Number(m);
    if (Number.isFinite(n)) {
      numbers.add(String(Math.abs(Math.round(n))));
      numbers.add(String(Math.abs(Math.round(n * 10) / 10)));
    }
  }
  const codes = new Set(text.match(CODE) ?? []);
  return { numbers, codes };
}

export function checkGrounding(reply: string, source: unknown): GroundingCheck {
  const { numbers, codes } = sourceTokens(source);
  const replyCodes = new Set(reply.match(CODE) ?? []);
  const withoutCodes = reply.replace(CODE, " ");
  const unsupportedNumbers = (withoutCodes.match(NUMBER) ?? []).map((n) => n.trim()).filter((n) => {
    const k = norm(n).replace(/^0+(?=\d)/, "");
    // Small counting words like "1 of 3" are allowed only if present too; no free pass.
    return !numbers.has(k) && !numbers.has(String(Number(k)));
  });
  const unknownCodes = [...replyCodes].filter((c) => !codes.has(c));
  return { ok: !unsupportedNumbers.length && !unknownCodes.length, unsupportedNumbers, unknownCodes };
}
