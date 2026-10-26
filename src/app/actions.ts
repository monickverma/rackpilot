"use server";

// Server Actions. Each one validates its input, calls the domain code in
// src/lib (which owns every stock change), then refreshes or redirects.

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { resetDatabase } from "@/db";
import { ClaudeReadError, claudeConfigured, parseWithClaude } from "@/lib/claude";
import { counterSale, countStock, receiveStock, StockError } from "@/lib/inventory";
import { cancelOrder, confirmOrder, draftFromParse, draftOrder, fulfilOrder, recheckOrder, type ConfirmInput, type Draft } from "@/lib/orders";

export interface ActionResult {
  ok?: string;
  error?: string;
}

const MAX_MESSAGE = 2000;

function fail(err: unknown): ActionResult {
  if (err instanceof StockError) return { error: err.message };
  console.error(err);
  return { error: "Something went wrong. Nothing was changed." };
}

const int = (v: FormDataEntryValue | null) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

function checkMessage(message: string): { text: string; error?: string } {
  const text = String(message ?? "").trim();
  if (!text) return { text, error: "Paste a WhatsApp message first." };
  if (text.length > MAX_MESSAGE) return { text, error: `Messages over ${MAX_MESSAGE} characters aren't supported.` };
  return { text };
}

export async function readOrderAction(message: string): Promise<{ draft?: Draft; error?: string }> {
  const { text, error } = checkMessage(message);
  return error ? { error } : { draft: draftOrder(text) };
}

/** The fallback: Claude turns the text into lines, then the usual matching runs. */
export async function readWithClaudeAction(message: string): Promise<{ draft?: Draft; error?: string }> {
  const { text, error } = checkMessage(message);
  if (error) return { error };
  if (!claudeConfigured()) return { error: "The Claude fallback is off. Add ANTHROPIC_API_KEY to .env.local and restart the app." };
  try {
    return { draft: draftFromParse(text, await parseWithClaude(text), "claude") };
  } catch (e) {
    if (e instanceof ClaudeReadError) return { error: e.message };
    throw e;
  }
}

export async function confirmOrderAction(input: ConfirmInput): Promise<ActionResult> {
  let created: { id: number };
  try {
    const lines = (input.lines ?? []).slice(0, 50).map((l) => ({
      sourceText: String(l.sourceText ?? "").slice(0, 200),
      qty: Number(l.qty),
      variantId: l.variantId === null || l.variantId === undefined ? null : Number(l.variantId),
      matchNote: l.matchNote ? String(l.matchNote).slice(0, 500) : null,
    }));
    created = confirmOrder({
      customerName: String(input.customerName ?? "").slice(0, 80),
      message: String(input.message ?? "").slice(0, MAX_MESSAGE),
      dueLabel: input.dueLabel ? String(input.dueLabel).slice(0, 20) : null,
      parser: input.parser === "claude" ? "claude" : "rules",
      lines,
    });
  } catch (err) {
    return fail(err);
  }
  redirect(`/orders/${created.id}`);
}

function orderAction(fn: (id: number) => unknown, done: string) {
  return async (_prev: ActionResult, form: FormData): Promise<ActionResult> => {
    const id = int(form.get("orderId"));
    if (!Number.isInteger(id)) return { error: "Missing order." };
    try {
      fn(id);
    } catch (err) {
      return fail(err);
    }
    refresh();
    return { ok: done };
  };
}

export async function fulfilOrderAction(prev: ActionResult, form: FormData) {
  return orderAction((id) => fulfilOrder(id), "Fulfilled: every reservation is now a sale in the ledger.")(prev, form);
}

export async function cancelOrderAction(prev: ActionResult, form: FormData) {
  return orderAction((id) => cancelOrder(id), "Cancelled: reserved stock is back on sale.")(prev, form);
}

export async function recheckOrderAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const id = int(form.get("orderId"));
  if (!Number.isInteger(id)) return { error: "Missing order." };
  let added = 0;
  try {
    added = recheckOrder(id);
  } catch (err) {
    return fail(err);
  }
  refresh();
  return added ? { ok: `Reserved ${added} more from current stock.` } : { error: "Still nothing free for the short lines." };
}

function variantAction(run: (variantId: number, form: FormData) => string) {
  return async (_prev: ActionResult, form: FormData): Promise<ActionResult> => {
    const variantId = int(form.get("variantId"));
    if (!Number.isInteger(variantId)) return { error: "Missing variant." };
    let ok: string;
    try {
      ok = run(variantId, form);
    } catch (err) {
      return fail(err);
    }
    refresh();
    return { ok };
  };
}

export async function receiveAction(prev: ActionResult, form: FormData) {
  return variantAction((variantId, f) => {
    const qty = int(f.get("qty"));
    receiveStock(variantId, qty, String(f.get("ref") ?? "").trim().slice(0, 40), null);
    return `Received ${qty}.`;
  })(prev, form);
}

export async function countAction(prev: ActionResult, form: FormData) {
  return variantAction((variantId, f) => {
    const counted = int(f.get("counted"));
    const id = countStock(variantId, counted, String(f.get("note") ?? "").trim().slice(0, 120) || null);
    return id === null ? "Count matches the record; nothing to adjust." : `Adjusted on-hand to ${counted}.`;
  })(prev, form);
}

export async function counterSaleAction(prev: ActionResult, form: FormData) {
  return variantAction((variantId, f) => {
    const qty = int(f.get("qty"));
    counterSale(variantId, qty);
    return `Sold ${qty} at the counter.`;
  })(prev, form);
}

export async function resetDemoAction(): Promise<void> {
  resetDatabase();
  redirect("/dashboard");
}
