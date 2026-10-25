"use client";

// Paste a WhatsApp message -> see what the rules read (or, when they aren't
// sure, ask Claude) -> fix any match -> confirm. Reading writes nothing; only
// "Confirm & reserve" touches stock.

import { useState, useTransition } from "react";
import { confirmOrderAction, readOrderAction, readWithClaudeAction } from "@/app/actions";
import { day, dueText } from "@/lib/format";
import type { InboxMessage } from "@/lib/inbox";
import type { Candidate } from "@/lib/match";
import type { Draft, DraftLine } from "@/lib/orders";
import { Highlighted, LEGEND, TOKEN_STYLE } from "./highlighted";
import { AlertIcon, CalendarIcon, CheckIcon, InboxIcon, SparklesIcon, TrashIcon } from "./icons";
import { Badge, Button, Card, CardHeader, cn, inputClass, Location, Mono } from "./ui";

interface EditLine {
  key: string;
  line: DraftLine;
  qty: number;
  variantId: number | null;
}

const sizeLabel = (s: string | null) => (s === "FREE" ? "free size" : s);
const said = (l: DraftLine) => [l.product?.replace("_", " "), l.colour, sizeLabel(l.size)].filter(Boolean).join(" · ") || "?";
const candidateLabel = (c: Candidate) =>
  `${c.productCode} ${c.productName} · ${c.colour} ${c.size === "FREE" ? "FS" : c.size} · ${c.location} · ${c.available} free`;

function StockCheck({ candidate, qty }: { candidate: Candidate | undefined; qty: number }) {
  if (!candidate) return <span className="text-xs text-warn">Nothing will be reserved</span>;
  const free = Math.max(candidate.available, 0);
  if (free >= qty) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ok">
        <CheckIcon size={13} /> Reserve {qty} of {free} free
      </span>
    );
  }
  const held = candidate.onHand - candidate.available;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-bad">
      <AlertIcon size={13} /> {free ? `Only ${free} free` : "None free"}, short {qty - free}
      {held > 0 && <span className="text-muted">· {held} held for other orders</span>}
    </span>
  );
}

export function OrderIntake({ inbox, claudeEnabled }: { inbox: InboxMessage[]; claudeEnabled: boolean }) {
  const [message, setMessage] = useState("");
  const [customer, setCustomer] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();

  function read(text = message, reader = readOrderAction) {
    setError(null);
    startReading(async () => {
      const res = await reader(text);
      if (res.error || !res.draft) {
        // A failed Claude reading keeps the rules' draft on screen.
        if (reader === readOrderAction) {
          setDraft(null);
          setLines([]);
        }
        setError(res.error ?? "Couldn't read that message.");
        return;
      }
      setDraft(res.draft);
      setLines(res.draft.lines.map((l, i) => ({ key: `${i}-${l.sourceText}`, line: l, qty: l.qty, variantId: l.match.chosenId })));
    });
  }

  function pick(m: InboxMessage) {
    setMessage(m.text);
    setCustomer(m.customer);
    read(m.text);
  }

  function update(key: string, patch: Partial<EditLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function confirm() {
    if (!draft) return;
    setError(null);
    startSaving(async () => {
      const res = await confirmOrderAction({
        customerName: customer,
        message: draft.message,
        dueLabel: draft.due?.label ?? null,
        parser: draft.parser,
        lines: lines.map((l) => {
          const c = l.line.match.candidates.find((x) => x.variantId === l.variantId);
          const changed = l.variantId !== l.line.match.chosenId;
          return {
            sourceText: l.line.sourceText,
            qty: l.qty,
            variantId: l.variantId,
            matchNote: l.variantId === null ? l.line.match.reason : changed ? `Chosen by hand: ${c?.productCode} ${c?.colour} ${c?.size}.` : l.line.match.reason,
          };
        }),
      });
      if (res?.error) setError(res.error);
    });
  }

  const totals = lines.reduce(
    (acc, l) => {
      const c = l.line.match.candidates.find((x) => x.variantId === l.variantId);
      const take = c ? Math.min(l.qty, Math.max(c.available, 0)) : 0;
      return { reserve: acc.reserve + take, short: acc.short + (c && take < l.qty ? 1 : 0), skipped: acc.skipped + (c ? 0 : 1) };
    },
    { reserve: 0, short: 0, skipped: 0 },
  );

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <Card className="h-fit lg:col-span-4">
        <CardHeader icon={<InboxIcon />} title="WhatsApp inbox" description="Synthetic messages. Click one to read it." />
        <ul className="divide-y divide-line">
          {inbox.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => pick(m)}
                className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-panel-2/60", message === m.text && "bg-accent-soft/50")}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-panel-2 text-[11px] font-semibold text-muted ring-1 ring-line">
                  {m.customer.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium">{m.customer}</span>
                    <span className="text-[11px] text-faint">{m.time}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-xs text-muted">{m.text}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-6 lg:col-span-8">
        <Card>
          <CardHeader title="Message" description="Paste it exactly as the customer sent it, Hinglish and all." />
          <div className="space-y-3 p-5">
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name" className={cn(inputClass, "max-w-xs")} maxLength={80} />
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  read();
                }
              }}
              rows={3}
              maxLength={2000}
              placeholder="Bhaiya 3 black kurti M, 2 L, 1 maroon XL, Saturday tak"
              className={cn(inputClass, "h-auto resize-y py-2 leading-6")}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">
                Read by rules{claudeEnabled ? "; Claude only if you ask" : ", no AI"}. Nothing changes until you confirm.
              </p>
              <Button variant="primary" onClick={() => read()} disabled={reading || !message.trim()}>
                {reading ? "Reading…" : "Read order"} <kbd className="hidden rounded border border-white/30 px-1 text-[10px] sm:inline">Ctrl ↵</kbd>
              </Button>
            </div>
            {error && <p className="text-sm text-bad">{error}</p>}
          </div>
        </Card>

        {draft && (
          <Card className={cn(reading && "opacity-60 transition-opacity")}>
            <CardHeader
              icon={<SparklesIcon />}
              title={draft.parser === "claude" ? "What Claude read" : "What RackPilot read"}
              description={
                draft.parser === "claude"
                  ? "Claude only turned the words into lines. RackPilot matched them to variants and free stock, the same as for the rules."
                  : "Coloured words were understood; red wavy ones weren't. Check each match before confirming."
              }
              action={<Badge tone={draft.confidence === "high" ? "ok" : draft.confidence === "medium" ? "warn" : "bad"}>{draft.confidence} confidence</Badge>}
            />
            {draft.parser === "rules" && draft.confidence !== "high" && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-warn-soft/40 px-5 py-3 text-[13px]">
                <span>
                  The rules aren&apos;t sure about this message.
                  {claudeEnabled ? " Claude can read it; stock is still checked here." : " Set ANTHROPIC_API_KEY in .env.local to offer a Claude reading."}
                </span>
                {claudeEnabled && (
                  <Button onClick={() => read(draft.message, readWithClaudeAction)} disabled={reading}>
                    <SparklesIcon size={14} /> {reading ? "Asking Claude…" : "Read with Claude"}
                  </Button>
                )}
              </div>
            )}
            {draft.parser === "claude" && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-accent-soft/40 px-5 py-3 text-[13px]">
                <span>Read by Claude. The order will be saved as read by Claude.</span>
                <Button size="sm" onClick={() => read(draft.message)} disabled={reading}>
                  Use the rules reading
                </Button>
              </div>
            )}
            <div className="border-b border-line px-5 py-4">
              {draft.parser === "claude" ? (
                <p className="text-[15px] leading-7">{draft.message}</p>
              ) : (
                <>
                  <Highlighted message={draft.message} tokens={draft.tokens} />
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted">
                    {LEGEND.map(([k, label]) => (
                      <span key={k} className="inline-flex items-center gap-1">
                        <span className={cn("rounded px-1", TOKEN_STYLE[k])}>{label === "not understood" ? "abc" : "Aa"}</span> {label}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {draft.due ? (
                  <Badge tone="warn">
                    <CalendarIcon size={12} /> Due {dueText(draft.due.label)}
                    {draft.due.at && ` · ${day(draft.due.at)}`}
                  </Badge>
                ) : (
                  <Badge>No due date</Badge>
                )}
                {draft.urgent && <Badge tone="bad">Urgent</Badge>}
                {draft.unknownWords.length > 0 && <Badge tone="bad">{draft.parser === "claude" ? "Unclear" : "Not understood"}: {draft.unknownWords.join(", ")}</Badge>}
              </div>
            </div>

            {lines.length ? (
              <ul className="divide-y divide-line">
                {lines.map((l, i) => {
                  const c = l.line.match.candidates.find((x) => x.variantId === l.variantId);
                  return (
                    <li key={l.key} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto]">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-[13px]">
                          <span className="grid size-5 place-items-center rounded-full bg-panel-2 text-[11px] text-muted">{i + 1}</span>
                          <span className="font-medium">{said(l.line)}</span>
                          <Mono className="text-muted">“{l.line.sourceText}”</Mono>
                          {l.line.inherited.length > 0 && <Badge>{l.line.inherited.join(" + ")} from line before</Badge>}
                          {l.line.warnings.map((w) => (
                            <Badge key={w} tone="warn">{w}</Badge>
                          ))}
                        </div>
                        <select
                          value={l.variantId ?? ""}
                          onChange={(e) => update(l.key, { variantId: e.target.value ? Number(e.target.value) : null })}
                          className={cn(inputClass, "max-w-full pr-8 text-[13px]", !c && "border-warn")}
                        >
                          <option value="">{l.line.match.candidates.length ? "— Choose a product —" : "— No match: skip this line —"}</option>
                          {l.line.match.candidates.map((x) => (
                            <option key={x.variantId} value={x.variantId}>
                              {candidateLabel(x)}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-muted">{l.variantId === l.line.match.chosenId ? l.line.match.reason : "Chosen by hand."}</p>
                      </div>
                      <div className="flex items-start gap-3 sm:flex-col sm:items-end">
                        <div className="flex items-center gap-2">
                          {c && <Location code={c.location} />}
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={l.qty}
                            onChange={(e) => update(l.key, { qty: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
                            className={cn(inputClass, "w-20 text-right tabular")}
                            aria-label="Quantity"
                          />
                          <button
                            type="button"
                            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                            className="grid size-9 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-bad"
                            aria-label="Remove line"
                          >
                            <TrashIcon size={15} />
                          </button>
                        </div>
                        <StockCheck candidate={c} qty={l.qty} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">No order lines found in this message.</p>
            )}

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel-2/40 px-5 py-4">
              <p className="text-[13px] text-muted">
                Will reserve <span className="font-semibold text-fg">{totals.reserve}</span> pcs
                {totals.short > 0 && <span className="text-bad"> · {totals.short} short</span>}
                {totals.skipped > 0 && <span className="text-warn"> · {totals.skipped} not matched</span>}
              </p>
              <Button variant="primary" onClick={confirm} disabled={saving || !lines.length}>
                {saving ? "Reserving…" : "Confirm & reserve"}
              </Button>
            </footer>
          </Card>
        )}
      </div>
    </div>
  );
}
