// The Investigation Centre's case actions: read a case, assign it, move it
// through its lifecycle, note and tick checks, apply an authorised
// correction, resolve and close. Every action leaves an investigation event
// and an audit event, and corrections re-run the checks so the findings show
// whether the records now agree.

import { one, q, run, tx } from "../../db/client.ts";
import type { InvestigationStatus, Outcome } from "../../db/schema.ts";
import { audit, can, DomainError, need, NotFoundError, nowOf, type Ctx, type Permission } from "../context.ts";
import { rupees, units } from "../format.ts";
import { issueInvoice, openInvoices, allocatePayment, recordPayment } from "../ops/billing.ts";
import { cancelRemainder, reopenOrder } from "../ops/orders.ts";
import { adjustStock, cancelTransfer, rebuildBalance, receiveTransfer, recordCount, releaseReservation, restockReturn, reverseMovement } from "../ops/stock.ts";
import { event, runChecks } from "./engine.ts";

export interface CaseFinding {
  id: number; module: "ordertrace" | "stocksleuth"; rule: string; version: number; fingerprint: string; kind: "fact" | "inference" | "hypothesis";
  certainty: "verified" | "likely" | "possible"; title: string; detail: string; expected: number | null; actual: number | null; unit: string | null;
  calculation: string | null; exceptions: string[]; missing: string[]; status: string; firstSeenAt: Date; lastSeenAt: Date;
}

export interface CaseEvidence { id: number; findingId: number | null; type: string; recordId: number; code: string; label: string; detail: string; values: Record<string, unknown>; at: Date }

export interface CaseView {
  id: number; code: string; module: "ordertrace" | "stocksleuth" | "both"; caseKey: string; title: string; summary: string; status: InvestigationStatus;
  outcome: Outcome | null; priority: "high" | "medium" | "low"; assigneeId: number | null; assignee: string | null; subjectType: string; subjectId: number;
  subjectCode: string; detectedAt: Date; updatedAt: Date; resolvedAt: Date | null; resolvedBy: string | null; resolutionNote: string | null;
  findings: CaseFinding[]; timeline: CaseEvidence[]; checks: { id: number; text: string; doneBy: string | null; doneAt: Date | null }[];
  events: { id: number; type: string; body: string; actor: string | null; data: Record<string, unknown>; at: Date }[];
  orderId: number | null;
}

export async function getCase(ctx: Ctx, code: string): Promise<CaseView | null> {
  const c = await one<Omit<CaseView, "findings" | "timeline" | "checks" | "events" | "orderId">>(
    `SELECT i.id, i.code, i.module, i.case_key AS "caseKey", i.title, i.summary, i.status, i.outcome, i.priority, i.assignee_id AS "assigneeId", u.name AS assignee,
            i.subject_type AS "subjectType", i.subject_id AS "subjectId", i.subject_code AS "subjectCode", i.detected_at AS "detectedAt", i.updated_at AS "updatedAt",
            i.resolved_at AS "resolvedAt", r.name AS "resolvedBy", i.resolution_note AS "resolutionNote"
       FROM investigations i LEFT JOIN users u ON u.id = i.assignee_id LEFT JOIN users r ON r.id = i.resolved_by
      WHERE i.business_id = $1 AND i.code = $2`,
    ctx.businessId, code.toUpperCase(),
  );
  if (!c) return null;
  const [findings, evidence, checks, events] = await Promise.all([
    q<CaseFinding>(
      `SELECT id, module, rule_id AS rule, rule_version AS version, fingerprint, kind, certainty, title, detail, expected_value AS expected, actual_value AS actual, unit,
              calculation, exceptions_checked AS exceptions, missing_evidence AS missing, status, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
         FROM investigation_findings WHERE investigation_id = $1
        ORDER BY CASE kind WHEN 'fact' THEN 0 WHEN 'inference' THEN 1 ELSE 2 END, CASE module WHEN 'ordertrace' THEN 0 ELSE 1 END, id`,
      c.id,
    ),
    q<{ id: number; findingId: number | null; type: string; recordId: number; code: string; label: string; snapshot: Record<string, unknown>; at: Date }>(
      `SELECT id, finding_id AS "findingId", record_type AS type, record_id AS "recordId", record_code AS code, label, snapshot, occurred_at AS at
         FROM investigation_evidence WHERE investigation_id = $1 ORDER BY occurred_at, length(snapshot->>'detail') DESC NULLS LAST, id`,
      c.id,
    ),
    q<CaseView["checks"][number]>(
      `SELECT ch.id, ch.text, u.name AS "doneBy", ch.done_at AS "doneAt" FROM investigation_checks ch LEFT JOIN users u ON u.id = ch.done_by WHERE ch.investigation_id = $1 ORDER BY ch.position`,
      c.id,
    ),
    q<CaseView["events"][number]>(
      `SELECT e.id, e.type, e.body, COALESCE(u.name, e.actor_process) AS actor, e.data, e.created_at AS at FROM investigation_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.investigation_id = $1 ORDER BY e.created_at, e.id`,
      c.id,
    ),
  ]);
  // One timeline entry per record and moment, keeping the first (richest) description:
  // two rules citing the same transfer at the same instant are one event.
  const seen = new Set<string>();
  const timeline: CaseEvidence[] = [];
  for (const e of evidence) {
    const k = `${e.type}|${e.recordId}|${new Date(e.at).getTime()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const { detail, ...values } = e.snapshot as { detail?: string } & Record<string, unknown>;
    timeline.push({ id: e.id, findingId: e.findingId, type: e.type, recordId: e.recordId, code: e.code, label: e.label, detail: detail ?? "", values, at: e.at });
  }
  return { ...c, findings, timeline, checks, events, orderId: c.caseKey.startsWith("order:") ? Number(c.caseKey.split(":")[1]) : null };
}

export async function listCases(ctx: Ctx, opts: { status?: "open" | "closed" | "all"; module?: string; assignee?: number } = {}) {
  return q<{ id: number; code: string; module: string; title: string; status: InvestigationStatus; outcome: Outcome | null; priority: string; assignee: string | null; subjectCode: string; subjectType: string; detectedAt: Date; updatedAt: Date; facts: number; open: number; value: number | null }>(
    `SELECT i.id, i.code, i.module, i.title, i.status, i.outcome, i.priority, u.name AS assignee, i.subject_code AS "subjectCode", i.subject_type AS "subjectType",
            i.detected_at AS "detectedAt", i.updated_at AS "updatedAt",
            (SELECT COUNT(*)::int FROM investigation_findings f WHERE f.investigation_id = i.id AND f.kind = 'fact') AS facts,
            (SELECT COUNT(*)::int FROM investigation_findings f WHERE f.investigation_id = i.id AND f.status = 'open' AND f.kind = 'fact') AS open,
            NULL::int AS value
       FROM investigations i LEFT JOIN users u ON u.id = i.assignee_id
      WHERE i.business_id = $1
        AND ($2::text = 'all' OR ($2 = 'open' AND i.status NOT IN ('resolved', 'closed')) OR ($2 = 'closed' AND i.status IN ('resolved', 'closed')))
        AND ($3::text IS NULL OR i.module = $3 OR i.module = 'both')
        AND ($4::int IS NULL OR i.assignee_id = $4)
      ORDER BY i.status IN ('resolved', 'closed'), CASE i.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, i.detected_at DESC`,
    ctx.businessId, opts.status ?? "open", opts.module ?? null, opts.assignee ?? null,
  );
}

async function requireCase(ctx: Ctx, code: string) {
  const c = await getCase(ctx, code);
  if (!c) throw new NotFoundError("Investigation not found.");
  return c;
}

const resolvePermission = (c: { code: string }): Permission => (c.code.startsWith("SS") ? "investigations.resolve.stocksleuth" : "investigations.resolve.ordertrace");
const isClosed = (s: string) => s === "resolved" || s === "closed";

export async function assign(ctx: Ctx, code: string, userId: number | null) {
  need(ctx, "investigations.work");
  const c = await requireCase(ctx, code);
  const user = userId ? await one<{ id: number; name: string }>(`SELECT id, name FROM users WHERE business_id = $1 AND id = $2`, ctx.businessId, userId) : null;
  if (userId && !user) throw new NotFoundError("That person isn't in this business.");
  await tx(async () => {
    await run(`UPDATE investigations SET assignee_id = $2, updated_at = $3, status = CASE WHEN status = 'detected' THEN 'investigating' ELSE status END WHERE id = $1`, c.id, user?.id ?? null, nowOf(ctx));
    await event(c.id, ctx.user.id, null, "assigned", user ? `Assigned to ${user.name}.` : "Unassigned.", {}, nowOf(ctx));
    await audit(ctx, "investigation.assigned", { type: "investigation", id: c.id, code: c.code }, null, { assignee: user?.name ?? null });
  });
}

const STATUS_FLOW: Record<InvestigationStatus, InvestigationStatus[]> = {
  detected: ["investigating", "action_required"],
  investigating: ["action_required", "detected"],
  action_required: ["investigating"],
  resolved: ["investigating"],
  closed: [],
};

export async function setStatus(ctx: Ctx, code: string, status: InvestigationStatus, note?: string) {
  need(ctx, "investigations.work");
  const c = await requireCase(ctx, code);
  if (!STATUS_FLOW[c.status].includes(status)) throw new DomainError(`A ${c.status.replace("_", " ")} case can't move to ${status.replace("_", " ")}.`);
  if (c.status === "resolved") need(ctx, "investigations.close");
  await tx(async () => {
    await run(`UPDATE investigations SET status = $2, updated_at = $3, outcome = CASE WHEN $2 = 'investigating' THEN NULL ELSE outcome END WHERE id = $1`, c.id, status, nowOf(ctx));
    await event(c.id, ctx.user.id, null, "status", `Status: ${status.replace("_", " ")}.${note ? ` ${note}` : ""}`, {}, nowOf(ctx));
    await audit(ctx, "investigation.status", { type: "investigation", id: c.id, code: c.code }, note ?? null, { from: c.status, to: status });
  });
}

export async function addNote(ctx: Ctx, code: string, body: string) {
  need(ctx, "investigations.work");
  const text = body.trim().slice(0, 2000);
  if (!text) throw new DomainError("Write a note first.");
  const c = await requireCase(ctx, code);
  await event(c.id, ctx.user.id, null, "note", text, {}, nowOf(ctx));
  await run(`UPDATE investigations SET updated_at = $2 WHERE id = $1`, c.id, nowOf(ctx));
}

export async function toggleCheck(ctx: Ctx, code: string, checkId: number, done: boolean) {
  need(ctx, "investigations.work");
  const c = await requireCase(ctx, code);
  const check = c.checks.find((x) => x.id === checkId);
  if (!check) throw new NotFoundError("Check not found.");
  await run(`UPDATE investigation_checks SET done_by = $2, done_at = $3 WHERE id = $1`, checkId, done ? ctx.user.id : null, done ? nowOf(ctx) : null);
  await event(c.id, ctx.user.id, null, "check", `${done ? "Done" : "Reopened"}: ${check.text}.`, {}, nowOf(ctx));
}

// ---- corrections ----

export interface Correction {
  id: string;
  label: string;
  detail: string;
  permission: Permission;
  allowed: boolean;
  outcome: Outcome;
  /** An input the person must give, e.g. the recounted quantity or the invoice to allocate to. */
  input?: { name: string; label: string; kind: "number" | "select"; options?: { value: string; label: string }[]; defaultValue?: string };
}

const parts = (fp: string) => fp.split(":");

/** The corrections the open findings allow, each tied to one finding and one permission. */
export async function corrections(ctx: Ctx, c: CaseView): Promise<Correction[]> {
  if (isClosed(c.status)) return [];
  const out: Omit<Correction, "allowed">[] = [];
  const open = c.findings.filter((f) => f.status === "open");
  for (const f of open) {
    const p = parts(f.fingerprint);
    if (f.rule === "OT-INV" && p[1] === "unbilled" && f.kind === "fact") {
      const diff = (f.expected ?? 0) - (f.actual ?? 0);
      out.push({ id: `invoice:${p[2]}:${diff}`, label: `Issue a supplementary invoice for ${units(diff)}`, detail: "If the invoice missed units that really shipped.", permission: "billing.write", outcome: "record_corrected" });
      out.push({ id: `free:${p[2]}:${diff}`, label: `Record ${units(diff)} as free replacement pieces (₹0 line)`, detail: "If the customer was promised them free; keeps billing and dispatch in agreement.", permission: "billing.write", outcome: "legitimate_partial_fulfilment" });
    }
    if (f.rule === "OT-INV" && p[1] === "overbilled") {
      const diff = (f.actual ?? 0) - (f.expected ?? 0);
      out.push({ id: `credit:${p[2]}:${diff}`, label: `Issue a credit note for ${units(diff)}`, detail: "If those units will not ship.", permission: "billing.write", outcome: "record_corrected" });
    }
    if (f.rule === "OT-STATUS" && p[1] === "unsupplied") {
      out.push({ id: `cancel-rest:${p[2]}`, label: `Cancel the ${units(Number(p[3]))} never shipped`, detail: "The customer no longer wants them; closes the line.", permission: "orders.write", outcome: "record_corrected" });
      out.push({ id: `reopen:${p[2]}`, label: "Reopen the order and backorder the rest", detail: "The customer still wants them.", permission: "orders.write", outcome: "record_corrected" });
    }
    if (f.rule === "OT-DUP" && p[1] === "payment") {
      out.push({ id: `reverse-pay:${p[3]}`, label: "Reverse the duplicate payment entry", detail: "Records a reversal against the second entry; the original payment stands.", permission: "billing.write", outcome: "record_corrected" });
    }
    if (f.rule === "OT-PAY" && p[1] === "over" && !open.some((x) => x.rule === "OT-DUP")) {
      out.push({ id: `refund:${p[2]}:${(f.actual ?? 0) - (f.expected ?? 0)}`, label: `Record a refund of ${rupees((f.actual ?? 0) - (f.expected ?? 0))}`, detail: "Once the excess has been paid back.", permission: "billing.write", outcome: "record_corrected" });
    }
    if (f.rule === "OT-PAY" && p[1] === "unallocated") {
      const pay = await one<{ customerId: number }>(`SELECT customer_id AS "customerId" FROM payments WHERE id = $1 AND business_id = $2`, Number(p[2]), ctx.businessId);
      const invs = pay ? await openInvoices(ctx, pay.customerId) : [];
      out.push({
        id: `allocate:${p[2]}`, label: "Allocate the payment to an invoice", detail: "Pick the invoice the remittance is for.", permission: "billing.write", outcome: "record_corrected",
        input: { name: "invoiceId", label: "Invoice", kind: "select", options: invs.map((i) => ({ value: String(i.id), label: `${i.code} · ${i.orderCode} · ${rupees(i.total)} billed, ${rupees(i.paid)} paid` })) },
      });
    }
    if (f.rule === "OT-MATCH" && p[1] === "shipment") {
      out.push({ id: `ship-customer:${p[2]}`, label: "Correct the shipment's customer to the order's", detail: "If the consignment note shows it was a data-entry slip.", permission: "orders.write", outcome: "record_corrected" });
    }
    if (f.rule === "SS-TRF") {
      out.push({ id: `receive:${p[1]}`, label: "Receive the transfer at the destination", detail: "The units were found there: book them out of the source and in at the destination.", permission: "warehouse.write", outcome: "goods_located" });
      out.push({ id: `cancel-trf:${p[1]}`, label: "Cancel the transfer: the goods never left", detail: "Nothing moves in the ledger.", permission: "warehouse.write", outcome: "record_corrected" });
    }
    if ((f.rule === "SS-PICK" || f.rule === "SS-STALE") && f.kind === "fact" && !p[1].startsWith("order")) {
      if (!out.some((x) => x.id === `putback:${p[1]}`)) out.push({ id: `putback:${p[1]}`, label: "Picked units found: put back and release the reservation", detail: "Frees the units for other orders; on-hand is unchanged because picking never moved it.", permission: "warehouse.write", outcome: "goods_located" });
    }
    if (f.rule === "SS-RET") out.push({ id: `restock:${p[1]}`, label: "Restock the return", detail: "Posts the customer-return movement to the bin.", permission: "warehouse.write", outcome: "record_corrected" });
    if (f.rule === "SS-DUP") out.push({ id: `reverse-move:${p[2]}`, label: "Reverse the duplicate movement", detail: "A compensating movement linked to the duplicate; the ledger keeps both.", permission: "stock.adjust", outcome: "record_corrected" });
    if (f.rule === "SS-COUNT" && f.kind === "fact") {
      const residual = (f.actual ?? 0) - (f.expected ?? 0);
      out.push({
        id: `recount:${p[2]}:${p[3]}`, label: "Record a recount", detail: "If the goods were found, a recount that matches the record closes the variance.", permission: "warehouse.write", outcome: "counting_error",
        input: { name: "counted", label: "Counted now", kind: "number" },
      });
      out.push({ id: `adjust:${p[2]}:${p[3]}:${residual}`, label: `Approve a stock adjustment of ${residual > 0 ? "+" : ""}${residual}`, detail: "Only once the checks are done and the units are confirmed missing.", permission: "stock.adjust", outcome: "adjustment_approved" });
    }
    if (f.rule === "SS-LOC" && !p[1].startsWith("order")) {
      out.push({ id: `moved-back:${p[2]}:${p[3]}`, label: "Goods moved back: recount both bins", detail: "Records a count of 0 where they were found; then recount the home bin.", permission: "warehouse.write", outcome: "goods_located" });
    }
    if (f.rule === "SS-LEDGER") {
      out.push({ id: `rebuild:${c.caseKey.split(":")[1]}:${c.caseKey.split(":")[2]}`, label: "Rebuild the balance from the ledger", detail: "Sets the stored balance back to the sum of its movements.", permission: "stock.adjust", outcome: "record_corrected" });
    }
  }
  const unique = [...new Map(out.map((x) => [x.id, x])).values()];
  return unique.map((x) => ({ ...x, allowed: can(ctx, x.permission) }));
}

export async function applyCorrection(ctx: Ctx, code: string, correctionId: string, input: Record<string, string> = {}) {
  const c = await requireCase(ctx, code);
  if (isClosed(c.status)) throw new DomainError(`${c.code} is ${c.status}.`);
  const available = await corrections(ctx, c);
  const corr = available.find((x) => x.id === correctionId);
  if (!corr) throw new DomainError("That correction doesn't apply to this case any more.");
  need(ctx, corr.permission);
  const p = correctionId.split(":");
  const n = (i: number) => Number(p[i]);
  const inv = { id: c.id, code: c.code };
  let summary: string;
  const orderOfItem = async (itemId: number) => (await one<{ orderId: number }>(`SELECT order_id AS "orderId" FROM order_items WHERE id = $1 AND business_id = $2`, itemId, ctx.businessId))!.orderId;
  switch (p[0]) {
    case "invoice": {
      const r = await issueInvoice(ctx, await orderOfItem(n(1)), { lines: [{ orderItemId: n(1), qty: n(2) }], note: `Supplementary invoice from ${c.code}` });
      summary = `Issued ${r.code} for ${units(n(2))} (${rupees(r.total)}).`;
      break;
    }
    case "free": {
      const r = await issueInvoice(ctx, await orderOfItem(n(1)), { lines: [{ orderItemId: n(1), qty: n(2), unitPrice: 0 }], note: `Free replacement pieces recorded from ${c.code}` });
      summary = `Issued ${r.code}: ${units(n(2))} at ₹0 as agreed free pieces.`;
      break;
    }
    case "credit": {
      const r = await issueInvoice(ctx, await orderOfItem(n(1)), { kind: "credit_note", lines: [{ orderItemId: n(1), qty: n(2) }], note: `Credit from ${c.code}` });
      summary = `Issued credit note ${r.code} for ${units(n(2))}.`;
      break;
    }
    case "cancel-rest":
      summary = `Cancelled ${units(await cancelRemainder(ctx, n(1), `From ${c.code}`))} never shipped.`;
      break;
    case "reopen": {
      const orderId = await orderOfItem(n(1));
      await run(`UPDATE order_items SET backordered = true WHERE id = $1`, n(1));
      await reopenOrder(ctx, orderId, `From ${c.code}`);
      summary = "Reopened the order with the line on backorder.";
      break;
    }
    case "reverse-pay": {
      const pay = await one<{ customerId: number; invoiceId: number; amount: number; code: string }>(`SELECT customer_id AS "customerId", invoice_id AS "invoiceId", amount, code FROM payments WHERE id = $1 AND business_id = $2`, n(1), ctx.businessId);
      if (!pay) throw new NotFoundError("Payment not found.");
      const r = await recordPayment(ctx, { customerId: pay.customerId, invoiceId: pay.invoiceId, amount: pay.amount, method: "upi", reference: `Reversal of duplicate entry ${pay.code}`, kind: "refund" });
      summary = `Recorded ${r.code} reversing ${pay.code} (${rupees(pay.amount)}).`;
      break;
    }
    case "refund": {
      const order = await one<{ customerId: number; invoiceId: number }>(`SELECT o.customer_id AS "customerId", (SELECT id FROM invoices WHERE order_id = o.id AND kind = 'invoice' ORDER BY issued_at DESC LIMIT 1) AS "invoiceId" FROM orders o WHERE o.id = $1 AND o.business_id = $2`, n(1), ctx.businessId);
      const r = await recordPayment(ctx, { customerId: order!.customerId, invoiceId: order!.invoiceId, amount: n(2), method: "bank", reference: `Refund of excess from ${c.code}`, kind: "refund" });
      summary = `Recorded refund ${r.code} of ${rupees(n(2))}.`;
      break;
    }
    case "allocate": {
      if (!input.invoiceId) throw new DomainError("Pick the invoice to allocate to.");
      summary = await allocatePayment(ctx, n(1), Number(input.invoiceId));
      break;
    }
    case "ship-customer": {
      const s = await one<{ code: string; orderCustomer: number; was: string; now: string }>(
        `SELECT s.code, o.customer_id AS "orderCustomer", sc.name AS was, oc.name AS now FROM shipments s JOIN orders o ON o.id = s.order_id
           JOIN customers sc ON sc.id = s.customer_id JOIN customers oc ON oc.id = o.customer_id WHERE s.id = $1 AND s.business_id = $2`,
        n(1), ctx.businessId,
      );
      if (!s) throw new NotFoundError("Shipment not found.");
      await run(`UPDATE shipments SET customer_id = $2 WHERE id = $1`, n(1), s.orderCustomer);
      await audit(ctx, "shipment.customer_corrected", { type: "shipment", id: n(1), code: s.code }, `From ${c.code}`, { before: s.was, after: s.now });
      summary = `${s.code} corrected from ${s.was} to ${s.now}.`;
      break;
    }
    case "receive": {
      const t = await receiveTransfer(ctx, n(1));
      summary = `Received ${t.code} at the destination; the ledger moved ${units(t.qty)}.`;
      break;
    }
    case "cancel-trf":
      await cancelTransfer(ctx, n(1), `Goods never left (${c.code})`);
      summary = "Cancelled the transfer; nothing moved.";
      break;
    case "putback": {
      const r = await releaseReservation(ctx, n(1), `Picked units put back on the bin (${c.code})`);
      summary = `Released ${units(r.qty)}; they are free to sell again.`;
      break;
    }
    case "restock":
      summary = `Restocked ${units(await restockReturn(ctx, n(1)))}.`;
      break;
    case "reverse-move": {
      const id = await reverseMovement(ctx, n(1), `Duplicate posting confirmed in ${c.code}`, inv);
      summary = `Posted movement #${id} reversing #${n(1)}.`;
      break;
    }
    case "recount": {
      const counted = Number(input.counted);
      if (!Number.isInteger(counted) || counted < 0) throw new DomainError("Enter the counted quantity.");
      const r = await recordCount(ctx, { scope: `Recount for ${c.code}`, lines: [{ variantId: n(1), locationId: n(2), counted }] });
      summary = `Recount ${r.code}: ${units(counted)} counted, ${units(r.lines[0].recorded)} recorded.`;
      break;
    }
    case "adjust": {
      await adjustStock(ctx, { variantId: n(1), locationId: n(2), qty: n(3), reason: `Approved in ${c.code} after the checks`, investigation: inv });
      summary = `Adjusted on-hand by ${n(3) > 0 ? "+" : ""}${n(3)}.`;
      break;
    }
    case "moved-back": {
      const home = await one<{ home: number }>(`SELECT home_location_id AS home FROM product_variants WHERE id = $1 AND business_id = $2`, n(1), ctx.businessId);
      const homeBal = await one<{ onHand: number }>(`SELECT on_hand AS "onHand" FROM inventory_balances WHERE variant_id = $1 AND location_id = $2`, n(1), home!.home);
      const r = await recordCount(ctx, { scope: `Goods moved back (${c.code})`, lines: [{ variantId: n(1), locationId: n(2), counted: 0 }, { variantId: n(1), locationId: home!.home, counted: homeBal?.onHand ?? 0 }] });
      summary = `Recorded ${r.code}: none left at the other bin, home bin matches its record.`;
      break;
    }
    case "rebuild": {
      const r = await rebuildBalance(ctx, n(1), n(2), `From ${c.code}`);
      summary = `Balance rebuilt from ${r.before.onHand} to ${r.after.onHand}.`;
      break;
    }
    default:
      throw new DomainError("Unknown correction.");
  }
  await event(c.id, ctx.user.id, null, "correction", `${corr.label}. ${summary}`, { correction: correctionId, outcome: corr.outcome }, nowOf(ctx));
  await audit(ctx, "investigation.correction", { type: "investigation", id: c.id, code: c.code }, corr.label, { correction: correctionId, summary });
  await run(`UPDATE investigations SET status = CASE WHEN status = 'detected' THEN 'investigating' ELSE status END, updated_at = $2 WHERE id = $1`, c.id, nowOf(ctx));
  await runChecks(ctx.businessId, nowOf(ctx));
  return { summary, suggestedOutcome: corr.outcome };
}

export async function resolveCase(ctx: Ctx, code: string, outcome: Outcome, note: string) {
  const c = await requireCase(ctx, code);
  need(ctx, resolvePermission(c));
  if (isClosed(c.status)) throw new DomainError(`${c.code} is already ${c.status}.`);
  const text = note.trim().slice(0, 2000);
  if (!text) throw new DomainError("Record what was verified and why this outcome.");
  await tx(async () => {
    await run(`UPDATE investigations SET status = 'resolved', outcome = $2, resolution_note = $3, resolved_at = $4, resolved_by = $5, updated_at = $4 WHERE id = $1`, c.id, outcome, text, nowOf(ctx), ctx.user.id);
    await run(`UPDATE investigation_findings SET status = 'confirmed' WHERE investigation_id = $1 AND status = 'open'`, c.id);
    await event(c.id, ctx.user.id, null, "resolution", `Resolved as ${outcome.replaceAll("_", " ")}: ${text}`, { outcome }, nowOf(ctx));
    await audit(ctx, "investigation.resolved", { type: "investigation", id: c.id, code: c.code }, text, { outcome });
  });
}

export async function closeCase(ctx: Ctx, code: string) {
  need(ctx, "investigations.close");
  const c = await requireCase(ctx, code);
  if (c.status !== "resolved") throw new DomainError("Resolve the case before closing it.");
  await run(`UPDATE investigations SET status = 'closed', updated_at = $2 WHERE id = $1`, c.id, nowOf(ctx));
  await event(c.id, ctx.user.id, null, "status", "Closed: the authorised resolution is complete.", {}, nowOf(ctx));
  await audit(ctx, "investigation.closed", { type: "investigation", id: c.id, code: c.code });
}
