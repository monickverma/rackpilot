// The shared investigation engine behind OrderTrace and StockSleuth.
//
// runChecks() runs every rule, groups the findings into cases (one per order,
// stock location or loose payment), adds each module's view of the other's
// records, and then reconciles with what is already stored:
//   - a finding that matches an open case's finding refreshes it;
//   - a new finding joins the open case for its subject, or opens a new case;
//   - a finding a person already resolved (same fingerprint, same numbers) is
//     not reopened;
//   - an open finding the rules no longer produce is marked as no longer
//     reproducing, but the case stays open until a person resolves it.
// It is deterministic and idempotent: running it twice changes nothing.

import { one, q, run, tx } from "../../db/client.ts";
import { orderTraceDrafts } from "./ordertrace.ts";
import { stockSideOfOrder, stockSleuthDrafts } from "./stocksleuth.ts";
import type { Draft, Priority } from "./types.ts";

const PRIORITY: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export interface CheckResult {
  created: string[];
  updated: string[];
  findings: number;
}

/** The deterministic rules' current output for a business, before it is stored. */
export async function currentDrafts(businessId: number, now: Date): Promise<Draft[]> {
  const drafts = [...(await orderTraceDrafts(businessId, now)), ...(await stockSleuthDrafts(businessId, now))];
  const seen = new Set<string>();
  return drafts.filter((d) => (seen.has(d.fingerprint) ? false : (seen.add(d.fingerprint), true)));
}

export async function runChecks(businessId: number, now = new Date(), opts: { process?: string; actorUserId?: number } = {}): Promise<CheckResult> {
  const drafts = await currentDrafts(businessId, now);
  const groups = new Map<string, Draft[]>();
  for (const d of drafts) groups.set(d.caseKey, [...(groups.get(d.caseKey) ?? []), d]);

  const existing = await q<{ id: number; code: string; caseKey: string; status: string; module: string; priority: Priority }>(
    `SELECT id, code, case_key AS "caseKey", status, module, priority FROM investigations WHERE business_id = $1`,
    businessId,
  );
  const findings = await q<{ id: number; investigationId: number; fingerprint: string; status: string; title: string }>(
    `SELECT f.id, f.investigation_id AS "investigationId", f.fingerprint, f.status, f.title FROM investigation_findings f
       JOIN investigations i ON i.id = f.investigation_id WHERE i.business_id = $1`,
    businessId,
  );
  const closedStatuses = new Set(["resolved", "closed"]);
  for (const i of existing) if (!closedStatuses.has(i.status) && !groups.has(i.caseKey)) groups.set(i.caseKey, []);
  const closedIds = new Set(existing.filter((i) => closedStatuses.has(i.status)).map((i) => i.id));
  const accepted = new Set(findings.filter((f) => closedIds.has(f.investigationId)).map((f) => f.fingerprint));

  // Cross-module context and the coverage inference for count variances.
  for (const [caseKey, list] of groups) {
    const live = list.filter((d) => !d.context && !accepted.has(d.fingerprint));
    const openCase = existing.find((i) => i.caseKey === caseKey && !closedStatuses.has(i.status));
    if (!live.length && !openCase) continue;
    if (caseKey.startsWith("order:")) {
      const id = Number(caseKey.split(":")[1]);
      const code = list[0]?.subject.code ?? (await one<{ code: string }>(`SELECT code FROM orders WHERE id = $1`, id))!.code;
      list.push(...(await stockSideOfOrder(businessId, id, code)));
    }
  }

  const result: CheckResult = { created: [], updated: [], findings: 0 };
  const order = [...groups.entries()].sort((a, b) => earliest(a[1]) - earliest(b[1]));
  const actor = opts.actorUserId ?? null;
  const process = opts.actorUserId ? null : (opts.process ?? "consistency check");

  await tx(async () => {
    const reproduced = new Set<string>();
    for (const [caseKey, list] of order) {
      const openCase = existing.find((i) => i.caseKey === caseKey && !closedStatuses.has(i.status));
      const fresh = list.filter((d) => !accepted.has(d.fingerprint));
      const primaries = fresh.filter((d) => !d.context);
      for (const d of fresh) reproduced.add(`${caseKey}|${d.fingerprint}`);
      if (!fresh.length || (!openCase && !primaries.length)) continue;
      const ranked = [...fresh].sort((a, b) => a.rank - b.rank);
      const lead = primaries.sort((a, b) => a.rank - b.rank)[0] ?? ranked[0];
      const modules = new Set(fresh.map((d) => d.module));
      const caseModule = modules.size > 1 ? "both" : [...modules][0];
      const priority = primaries.reduce<Priority>((p, d) => (PRIORITY[d.priority] < PRIORITY[p] ? d.priority : p), "low");
      let caseId: number;
      let caseCode: string;
      const detectedAt = new Date(Math.min(earliest(list), now.getTime()));
      if (!openCase) {
        caseCode = await nextCode(businessId, caseKey.startsWith("stock:") ? "SS" : "OT");
        caseId = (await one<{ id: number }>(
          `INSERT INTO investigations (business_id, code, module, case_key, title, summary, status, priority, subject_type, subject_id, subject_code, detected_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'detected', $7, $8, $9, $10, $11, $11) RETURNING id`,
          businessId, caseCode, caseModule, caseKey, lead.caseTitle ?? lead.title, lead.detail, priority, lead.subject.type, lead.subject.id, lead.subject.code, detectedAt,
        ))!.id;
        await event(caseId, actor, process, "detected", `Opened by the ${lead.rule} rule: ${lead.title}.`, { rule: lead.rule }, detectedAt);
        result.created.push(caseCode);
        const checks = [...new Set(ranked.flatMap((d) => d.checks ?? []))].slice(0, 7);
        for (const [i, text] of checks.entries()) await run(`INSERT INTO investigation_checks (investigation_id, position, text) VALUES ($1, $2, $3)`, caseId, i, text);
      } else {
        caseId = openCase.id;
        caseCode = openCase.code;
        if (openCase.module !== caseModule && openCase.module !== "both") await run(`UPDATE investigations SET module = 'both' WHERE id = $1`, caseId);
        if (PRIORITY[priority] < PRIORITY[openCase.priority]) await run(`UPDATE investigations SET priority = $2 WHERE id = $1`, caseId, priority);
      }
      for (const d of ranked) {
        const known = findings.find((f) => f.investigationId === caseId && f.fingerprint === d.fingerprint);
        if (known) {
          await run(`UPDATE investigation_findings SET last_seen_at = $2, status = CASE WHEN status = 'no_longer_reproduces' THEN 'open' ELSE status END WHERE id = $1`, known.id, now);
          continue;
        }
        const fid = (await one<{ id: number }>(
          `INSERT INTO investigation_findings (investigation_id, module, rule_id, rule_version, fingerprint, kind, certainty, title, detail, expected_value, actual_value, unit,
                                               calculation, exceptions_checked, missing_evidence, status, first_seen_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'open', $16, $16) RETURNING id`,
          caseId, d.module, d.rule, d.version, d.fingerprint, d.kind, d.certainty, d.title, d.detail, d.expected ?? null, d.actual ?? null, d.unit ?? null,
          d.calculation ?? null, JSON.stringify(d.exceptions ?? []), JSON.stringify(d.missing ?? []), new Date(Math.min(d.at.getTime(), now.getTime())),
        ))!.id;
        for (const e of d.evidence) {
          await run(
            `INSERT INTO investigation_evidence (investigation_id, finding_id, record_type, record_id, record_code, label, snapshot, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            caseId, fid, e.type, e.id, e.code, e.label, JSON.stringify({ detail: e.detail, ...(e.values ?? {}) }), e.at,
          );
        }
        result.findings++;
        if (openCase) {
          await event(caseId, actor, process, "finding", `New ${d.kind}: ${d.title}.`, { rule: d.rule }, now);
          if (!result.updated.includes(caseCode)) result.updated.push(caseCode);
        }
      }
    }
    // Open findings the rules no longer produce.
    for (const inv of existing.filter((i) => !closedStatuses.has(i.status))) {
      const stale = findings.filter((f) => f.investigationId === inv.id && f.status === "open" && !reproduced.has(`${inv.caseKey}|${f.fingerprint}`));
      for (const f of stale) {
        await run(`UPDATE investigation_findings SET status = 'no_longer_reproduces' WHERE id = $1`, f.id);
        await event(inv.id, actor, process, "finding", `No longer reproduces: ${f.title}.`, {}, now);
        if (!result.updated.includes(inv.code)) result.updated.push(inv.code);
      }
      if (stale.length) {
        const left = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM investigation_findings WHERE investigation_id = $1 AND status = 'open' AND kind = 'fact'`, inv.id);
        if (left && left.n === 0) await event(inv.id, actor, process, "status", "Every factual finding now reconciles. A person should confirm the cause and resolve the case.", {}, now);
      }
    }
    if (result.created.length || result.updated.length) {
      await run(`UPDATE investigations SET updated_at = $2 WHERE business_id = $1 AND code = ANY($3::text[])`, businessId, now, [...result.created, ...result.updated]);
    }
  });
  return result;
}

function earliest(list: Draft[]) {
  const primaries = list.filter((d) => !d.context);
  return Math.min(...(primaries.length ? primaries : list).map((d) => d.at.getTime()));
}

async function nextCode(businessId: number, prefix: string) {
  const row = await one<{ n: number | null }>(
    `SELECT MAX(CAST(substring(code FROM '[0-9]+$') AS int)) AS n FROM investigations WHERE business_id = $1 AND code LIKE $2`,
    businessId, `${prefix}-%`,
  );
  return `${prefix}-${String((row?.n ?? 0) + 1).padStart(3, "0")}`;
}

export async function event(investigationId: number, actorUserId: number | null, process: string | null, type: string, body: string, data: object, at: Date) {
  await run(
    `INSERT INTO investigation_events (investigation_id, actor_user_id, actor_process, type, body, data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    investigationId, actorUserId, process, type, body, JSON.stringify(data), at,
  );
}
