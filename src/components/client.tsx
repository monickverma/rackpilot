"use client";

// Client helpers for calling the API: one hook that posts JSON, tracks the
// pending state and the result message, and refreshes the server-rendered page.

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button, cn } from "./ui";

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function callApi<T = unknown>(url: string, body?: unknown, method = "POST"): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method, headers: body instanceof FormData ? undefined : { "content-type": "application/json" }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json().catch(() => ({ ok: false, error: `Request failed (${res.status}).` }))) as ApiResult<T>;
    return json;
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

export function useApi() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  function run<T>(url: string, body: unknown, opts: { ok?: string | ((data: T) => string); then?: (data: T) => void; method?: string } = {}) {
    setMessage(null);
    start(async () => {
      const res = await callApi<T>(url, body, opts.method);
      if (!res.ok) {
        setMessage({ ok: false, text: res.error ?? "Something went wrong." });
        return;
      }
      const okText = typeof opts.ok === "function" ? opts.ok(res.data as T) : opts.ok;
      if (okText) setMessage({ ok: true, text: okText });
      opts.then?.(res.data as T);
      router.refresh();
    });
  }
  return { run, pending, message, setMessage };
}

export function Message({ message, className }: { message: { ok: boolean; text: string } | null; className?: string }) {
  if (!message) return null;
  return (
    <p role="status" className={cn("text-xs", message.ok ? "text-ok" : "text-bad", className)}>
      {message.text}
    </p>
  );
}

/** A button that posts one action and refreshes the page. */
export function ActionButton({ url, body, children, variant = "secondary", size = "md", confirm, ok, disabled, title, className }: {
  url: string; body: unknown; children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md";
  confirm?: string; ok?: string; disabled?: boolean; title?: string; className?: string;
}) {
  const api = useApi();
  return (
    <span className={cn("inline-flex flex-col items-start gap-1", className)}>
      <Button
        type="button" variant={variant} size={size} disabled={disabled || api.pending} title={title}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          api.run(url, body, { ok });
        }}
      >
        {api.pending ? "Working…" : children}
      </Button>
      <Message message={api.message} />
    </span>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
