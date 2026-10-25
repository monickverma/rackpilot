"use client";

// The rule-based parser running in the browser: same code as the server, no
// network call, so you can see exactly what it does with any message.

import { useDeferredValue, useState } from "react";
import { dueText } from "@/lib/format";
import { parseOrder } from "@/lib/parser/parse";
import { Highlighted } from "./highlighted";
import { Badge, cn, inputClass } from "./ui";

export function ParserPlayground({ examples }: { examples: string[] }) {
  const [text, setText] = useState(examples[0] ?? "");
  const deferred = useDeferredValue(text);
  const result = parseOrder(deferred);
  return (
    <div className="space-y-4 p-5">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} className={cn(inputClass, "h-auto py-2 leading-6")} />
      <div className="flex flex-wrap gap-1.5">
        {examples.map((e) => (
          <button key={e} type="button" onClick={() => setText(e)} className="max-w-60 truncate rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:border-line-strong hover:text-fg">
            {e}
          </button>
        ))}
      </div>
      {deferred.trim() && (
        <div className="rounded-lg border border-line bg-panel-2/50 p-4">
          <Highlighted message={deferred} tokens={result.tokens} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone={result.confidence === "high" ? "ok" : result.confidence === "medium" ? "warn" : "bad"}>{result.confidence} confidence</Badge>
            {result.due && <Badge tone="warn">due {dueText(result.due.label)}</Badge>}
            {result.urgent && <Badge tone="bad">urgent</Badge>}
          </div>
          <ul className="mt-3 space-y-1 font-mono text-[12px]">
            {result.lines.map((l, i) => (
              <li key={i}>
                {l.qty} × {l.product ?? "?"} · {l.colour ?? "?"} · {l.size ?? "?"}
                {l.descriptors.length > 0 && <span className="text-muted"> [{l.descriptors.join(", ")}]</span>}
                {l.warnings.length > 0 && <span className="text-warn"> {l.warnings.join("; ")}</span>}
              </li>
            ))}
            {!result.lines.length && <li className="text-muted">No lines found.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
