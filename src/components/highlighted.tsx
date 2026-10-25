// Shows a message with each word coloured by what the parser took it to be.
// No hooks, so it renders on the server or in the browser.

import type { ReactNode } from "react";
import type { Token, TokenKind } from "@/lib/parser/types";
import { cn } from "./ui";

export const TOKEN_STYLE: Partial<Record<TokenKind, string>> = {
  qty: "bg-accent-soft text-accent font-semibold",
  each: "bg-accent-soft text-accent",
  product: "bg-ok-soft text-ok font-medium",
  colour: "bg-info-soft text-info font-medium",
  size: "bg-panel-2 text-fg font-semibold ring-1 ring-inset ring-line-strong",
  descriptor: "text-fg underline decoration-dotted decoration-2 underline-offset-4",
  code: "bg-panel-2 text-fg font-mono",
  price: "bg-panel-2 text-fg",
  due: "bg-warn-soft text-warn font-medium",
  urgent: "bg-bad-soft text-bad font-medium",
  unknown: "text-bad underline decoration-wavy decoration-bad/70 underline-offset-4",
  filler: "text-muted",
  sep: "text-muted",
  unit: "text-muted",
};

export const LEGEND: [TokenKind, string][] = [
  ["qty", "quantity"], ["product", "product"], ["colour", "colour"], ["size", "size"], ["due", "due"], ["unknown", "not understood"],
];

export function Highlighted({ message, tokens }: { message: string; tokens: Token[] }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const t of [...tokens].sort((a, b) => a.start - b.start)) {
    if (t.start < at) continue;
    if (t.start > at) out.push(message.slice(at, t.start));
    out.push(
      <span key={t.start} title={t.kind} className={cn("rounded px-0.5 py-px", TOKEN_STYLE[t.kind])}>
        {message.slice(t.start, t.end)}
      </span>,
    );
    at = t.end;
  }
  if (at < message.length) out.push(message.slice(at));
  return <p className="whitespace-pre-wrap text-[15px] leading-8">{out}</p>;
}
