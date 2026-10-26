// Shows a message with each word coloured by what the parser took it to be.
// No hooks, so it renders on the server or in the browser.

import type { ReactNode } from "react";
import type { Token, TokenKind } from "@/lib/parser/types";
import { cn } from "./ui";

export const TOKEN_STYLE: Partial<Record<TokenKind, string>> = {
  qty: "bg-tag-blue text-tag-blue-fg font-semibold",
  each: "bg-tag-blue text-tag-blue-fg",
  product: "bg-tag-green text-tag-green-fg font-medium",
  colour: "bg-tag-purple text-tag-purple-fg font-medium",
  size: "bg-tag-grey text-fg font-semibold ring-1 ring-inset ring-line-strong",
  descriptor: "text-fg underline decoration-dotted decoration-2 underline-offset-4",
  code: "bg-tag-grey text-fg font-mono",
  price: "bg-tag-grey text-fg",
  due: "bg-tag-orange text-tag-orange-fg font-medium",
  urgent: "bg-tag-red text-tag-red-fg font-medium",
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
      <span key={t.start} title={t.kind} className={cn("rounded-[4px] px-0.5 py-px", TOKEN_STYLE[t.kind])}>
        {message.slice(t.start, t.end)}
      </span>,
    );
    at = t.end;
  }
  if (at < message.length) out.push(message.slice(at));
  return <p className="whitespace-pre-wrap text-[14px] leading-8">{out}</p>;
}
