"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { callApi } from "@/components/client";
import { AlertIcon, CheckIcon, InboxIcon, MicIcon, SparklesIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { Badge, Button, Card, CardHeader, cn, inputClass, Mono, tabClass } from "@/components/ui";
import type { Draft, DraftLine } from "@/lib/intake/draft";
import type { Candidate } from "@/lib/intake/match";

type Channel = "message" | "voice" | "document";
interface Sample { id: string; label: string; channel: Channel; customer: string; text: string }
interface Edit { key: string; line: DraftLine; qty: number | null; variantId: number | null; drop: boolean }

const STATUS = { matched: ["ok", "Matched"], "needs-choice": ["warn", "Choose"], unmatched: ["bad", "Not in catalogue"] } as const;
const label = (c: Candidate) => `${c.sku} · ${c.productName} · ${c.location} · ${c.available} free`;

type SpeechCtor = new () => { lang: string; interimResults: boolean; continuous: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; start: () => void; stop: () => void };

export function Intake({ customers, samples, initial, claude }: { customers: { id: number; name: string; city: string }[]; samples: Sample[]; initial: Sample | null; claude: boolean }) {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>(initial?.channel ?? "message");
  const [text, setText] = useState(initial?.text ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [customerId, setCustomerId] = useState<number | "">(customers.find((c) => c.name === initial?.customer)?.id ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [due, setDue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [listening, setListening] = useState(false);
  const recog = useRef<InstanceType<SpeechCtor> | null>(null);
  const [speech, setSpeech] = useState(false);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    // Feature detection has to wait for the browser; the server render has no window.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeech(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  function read(reader: "rules" | "claude", t = text, ch = channel) {
    setError(null);
    startReading(async () => {
      let res;
      if (ch === "document" && file) {
        const form = new FormData();
        form.set("file", file);
        form.set("text", t);
        res = await callApi<Draft>("/api/intake", form);
      } else res = await callApi<Draft>("/api/intake", { text: t, channel: ch, reader });
      if (!res.ok || !res.data) {
        setError(res.error ?? "Couldn't read that.");
        return;
      }
      const d = res.data;
      setDraft(d);
      setEdits(d.lines.map((l) => ({ key: l.key, line: l, qty: l.qty, variantId: l.match.chosenId, drop: false })));
      setDue(d.due?.label ?? "");
      if (!customerId && d.customerGuess) setCustomerId(d.customerGuess.id);
    });
  }

  function pickSample(s: Sample) {
    setChannel(s.channel);
    setText(s.text);
    setFile(null);
    setCustomerId(customers.find((c) => c.name === s.customer)?.id ?? "");
    read("rules", s.text, s.channel);
  }

  function listen() {
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) {
      recog.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = "en-IN";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => setText((t) => `${t} ${Array.from(e.results).map((x) => x[0].transcript).join(" ")}`.trim());
    r.onend = () => setListening(false);
    recog.current = r;
    setListening(true);
    r.start();
  }

  const live = edits.filter((e) => !e.drop);
  const blockers = [
    !customerId && "pick the customer",
    live.some((e) => !e.variantId) && "choose a variant for every line (or remove it)",
    live.some((e) => !e.qty || e.qty < 1) && "give every line a quantity",
    !live.length && "keep at least one line",
  ].filter(Boolean) as string[];

  function confirm() {
    if (!draft) return;
    setError(null);
    startSaving(async () => {
      const res = await callApi<{ code: string }>("/api/orders", {
        customerId, channel: draft.channel, sourceText: draft.text, extractedBy: draft.extractedBy, dueLabel: due || null,
        lines: live.map((e) => ({ variantId: e.variantId, qty: e.qty, sourceText: e.line.sourceText, matchNote: e.line.match.reason })),
      });
      if (!res.ok || !res.data) return setError(res.error ?? "Couldn't save the order.");
      router.push(`/orders/${res.data.code}?new=1`);
    });
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-3">
        <Card>
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2.5">
            {(["message", "voice", "document"] as Channel[]).map((c) => (
              <button key={c} type="button" onClick={() => setChannel(c)} className={tabClass(channel === c)}>
                {c === "message" ? "Message" : c === "voice" ? "Voice-note transcript" : "Photo or PDF"}
              </button>
            ))}
          </div>
          <div className="space-y-3 px-6 py-4">
            {channel === "document" ? (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-6 py-8 text-center txt-small text-muted hover:bg-panel-2">
                <UploadIcon size={18} />
                {file ? <span className="text-fg">{file.name}</span> : "Choose a photo or PDF of an order sheet or delivery note"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {!claude && <span className="text-xs text-warn">Reading files needs Claude (ANTHROPIC_API_KEY). Paste the text instead to use the rules.</span>}
              </label>
            ) : null}
            <textarea
              value={text} onChange={(e) => setText(e.target.value)} rows={channel === "document" ? 2 : 4}
              placeholder={channel === "voice" ? "Paste the transcript of a voice note, or dictate it" : channel === "document" ? "Optional note for the reader" : "Bhai, 2 black oversized tees size L, 1 white tee size M. Need everything by tomorrow."}
              className={cn(inputClass, "h-auto w-full resize-y py-2 leading-6")}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={reading || (channel === "document" ? !file : !text.trim())} onClick={() => read(channel === "document" ? "claude" : "rules")}>
                {reading ? "Reading…" : channel === "document" ? "Read with Claude" : "Read with rules"}
              </Button>
              {channel !== "document" && (
                <Button disabled={reading || !claude || !text.trim()} onClick={() => read("claude")} title={claude ? "Claude reads the text into the same fixed schema; the matcher still decides the variant." : "Add ANTHROPIC_API_KEY to turn this on."}>
                  <SparklesIcon size={14} /> Read with Claude
                </Button>
              )}
              {channel === "voice" && speech && (
                <Button onClick={listen}><MicIcon size={14} /> {listening ? "Stop" : "Dictate"}</Button>
              )}
              {!claude && <span className="text-xs text-faint">Claude is off; the rules work without it.</span>}
            </div>
            {error && <p className="text-xs text-bad">{error}</p>}
          </div>
        </Card>

        {draft && (
          <Card>
            <CardHeader
              title="Check the lines"
              description={`Read by ${draft.extractedBy === "claude" ? "Claude (structured output), matched by RackPilot's rules" : "rules"}. Confidence: ${draft.confidence}.`}
              action={draft.urgent ? <Badge tone="warn">Urgent</Badge> : undefined}
            />
            <ul className="divide-y divide-line">
              {edits.map((e, i) => {
                const m = e.line.match;
                const chosen = m.candidates.find((c) => c.variantId === e.variantId);
                const [tone, word] = STATUS[m.status];
                return (
                  <li key={e.key} className={cn("px-6 py-3", e.drop && "opacity-40")}>
                    <div className="flex flex-wrap items-start gap-3">
                      <input
                        type="number" min={1} value={e.qty ?? ""} disabled={e.drop} aria-label="Quantity"
                        onChange={(ev) => setEdits((xs) => xs.map((x, j) => (j === i ? { ...x, qty: ev.target.value ? Number(ev.target.value) : null } : x)))}
                        className={cn(inputClass, "w-20 text-right tabular")}
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <Badge tone={tone}>{word}</Badge>
                          <span>From “<span className="text-fg">{e.line.sourceText}</span>”</span>
                          {e.line.inherited.length > 0 && <span>· {e.line.inherited.join(" and ")} carried from the line before</span>}
                        </div>
                        <select
                          value={e.variantId ?? ""} disabled={e.drop} aria-label="Variant"
                          onChange={(ev) => setEdits((xs) => xs.map((x, j) => (j === i ? { ...x, variantId: ev.target.value ? Number(ev.target.value) : null } : x)))}
                          className={cn(inputClass, "w-full")}
                        >
                          <option value="">{m.candidates.length ? "Choose the variant…" : "No candidates: remove this line"}</option>
                          {m.candidates.map((c) => <option key={c.variantId} value={c.variantId}>{label(c)}</option>)}
                        </select>
                        <p className="text-xs text-muted">{m.reason}</p>
                        {e.line.warnings.filter((w) => !/missing/.test(w) || m.status !== "matched").map((w) => <p key={w} className="text-xs text-warn">{w}</p>)}
                        {chosen && e.qty && (chosen.available >= e.qty
                          ? <p className="inline-flex items-center gap-1 text-xs text-ok"><CheckIcon size={13} /> {e.qty} of {chosen.available} free at <Mono>{chosen.location}</Mono></p>
                          : <p className="inline-flex items-center gap-1 text-xs text-bad"><AlertIcon size={13} /> Only {Math.max(chosen.available, 0)} free: {e.qty - Math.max(chosen.available, 0)} will be short, and you decide what happens to them after confirming</p>)}
                      </div>
                      <Button variant="ghost" size="sm" aria-label={e.drop ? "Keep line" : "Remove line"} onClick={() => setEdits((xs) => xs.map((x, j) => (j === i ? { ...x, drop: !x.drop } : x)))}>
                        {e.drop ? "Keep" : <TrashIcon size={14} />}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {draft.ignored.length > 0 && <p className="border-t border-line px-6 py-3 text-xs text-muted">Not understood: {draft.ignored.join(", ")}</p>}
          </Card>
        )}
      </div>

      <div className="space-y-3">
        <Card>
          <CardHeader icon={<InboxIcon />} title="Sample orders" description="Synthetic messages, including ambiguous ones." />
          <ul className="divide-y divide-line">
            {samples.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => pickSample(s)} className="block w-full px-6 py-2.5 text-left transition-colors hover:bg-panel-2">
                  <div className="text-[13px] font-medium">{s.label}</div>
                  <div className="truncate text-xs text-muted">{s.customer} · {s.text}</div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Confirm" description="Validates every line, then reserves free stock in one transaction." />
          <div className="space-y-3 px-6 py-4">
            <label className="block text-xs text-muted">
              Customer
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : "")} className={cn(inputClass, "mt-1 w-full")}>
                <option value="">Choose…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.city}</option>)}
              </select>
            </label>
            <label className="block text-xs text-muted">
              Due
              <select value={due} onChange={(e) => setDue(e.target.value)} className={cn(inputClass, "mt-1 w-full")}>
                <option value="">No date given</option>
                {["today", "tomorrow", "day-after", "this-week", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => <option key={d} value={d}>{d.replace("-", " ")}</option>)}
              </select>
            </label>
            {draft && blockers.length > 0 && <p className="text-xs text-warn">Before confirming: {blockers.join("; ")}.</p>}
            <Button variant="primary" className="w-full" disabled={!draft || blockers.length > 0 || saving} onClick={confirm}>
              {saving ? "Reserving…" : "Confirm and reserve stock"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
