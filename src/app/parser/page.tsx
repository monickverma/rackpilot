import type { Metadata } from "next";
import { CheckIcon, FlaskIcon, XIcon } from "@/components/icons";
import { ParserPlayground } from "@/components/parser-playground";
import { Badge, Card, CardHeader, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { evaluate, pct, type TestCase } from "@/lib/parser/evaluate";
import { parseOrder } from "@/lib/parser/parse";
import testset from "../../../data/parser-testset.json";

export const metadata: Metadata = { title: "Parser accuracy" };

const cases = (testset as unknown as { cases: TestCase[] }).cases;

export default function ParserPage() {
  // Pure and deterministic, so this runs once at build time.
  const { results, summary: s } = evaluate(cases, parseOrder);
  const failures = results.filter((r) => !r.pass);
  const precision = s.lines.predicted ? Math.round((100 * s.lines.correct) / s.lines.predicted) : 0;
  const recall = s.lines.expected ? Math.round((100 * s.lines.correct) / s.lines.expected) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Parser accuracy"
        title="How well the rules read WhatsApp orders"
        description="50 hand-labelled messages (39 Hinglish, 11 English). A message only counts as correct if every line's product, colour, size and quantity and the due date all match exactly."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="All messages" value={`${s.cases.passed}/${s.cases.total}`} sub={`${pct(s.cases)}% fully correct`} />
        <Stat label="Holdout" value={`${s.holdout.passed}/${s.holdout.total}`} sub="written first, kept aside" />
        <Stat label="Hinglish" value={`${s.hinglish.passed}/${s.hinglish.total}`} sub={`English ${s.english.passed}/${s.english.total}`} />
        <Stat label="Line items" value={`${recall}%`} sub={`recall · ${precision}% precision · due ${s.due.passed}/${s.due.total}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader icon={<FlaskIcon />} title="Try it" description="The same parser, running in your browser." />
          <ParserPlayground
            examples={[
              "Bhaiya 3 black kurti M, 2 L, 1 maroon XL, Saturday tak",
              "didi ek kaala legging M aur 2 safed L kal tak bhej do",
              "Size M: 2 black, 1 navy. Kurti. Monday",
              "2-2 piece palazzo white aur black, L size, urgent",
            ]}
          />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="How it was measured" />
          <div className="space-y-3 p-5 text-[13px] leading-6 text-muted">
            <p>
              The labelled messages were written before the rules. {s.dev.total} are a <span className="text-fg">dev</span> set the rules were built against ({s.dev.passed}/{s.dev.total} now pass), and{" "}
              {s.holdout.total} were kept aside as a <span className="text-fg">holdout</span>.
            </p>
            <p>
              First run on the holdout: <span className="text-fg">13/16</span>. One failure (h06, <code className="font-mono text-[12px]">Size M: 2 black</code>) exposed a real bug: a colon was gluing words together. Fixing it took the holdout to {s.holdout.passed}/{s.holdout.total}, so h06 no longer counts as unseen.
            </p>
            <p>The failures below are left unfixed on purpose. When the rules aren&apos;t sure, the order screen shows the unknown words and asks the owner to choose.</p>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title={`Failures (${failures.length})`} description="Expected vs what the rules produced." />
        {failures.length ? (
          <ul className="divide-y divide-line">
            {failures.map((r) => (
              <li key={r.id} className="px-5 py-3.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{r.id}</span>
                  <Badge tone={r.split === "holdout" ? "accent" : "neutral"}>{r.split}</Badge>
                  <span>“{r.message}”</span>
                </div>
                <ul className="mt-1.5 space-y-0.5 font-mono text-[12px]">
                  {r.missing.map((m) => <li key={`m${m}`} className="text-bad">− expected {m}</li>)}
                  {r.extra.map((e) => <li key={`e${e}`} className="text-warn">+ got {e}</li>)}
                  {!r.duePass && <li className="text-bad">due: expected {r.expected.due ?? "none"}, got {r.got.due ?? "none"}</li>}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-muted">None.</p>
        )}
      </Card>

      <Card className="mt-6">
        <details>
          <summary className="cursor-pointer select-none px-5 py-4 text-sm font-semibold">All {results.length} messages</summary>
          <Table>
            <thead>
              <tr>
                <Th>Case</Th>
                <Th>Set</Th>
                <Th>Message</Th>
                <Th align="center">Result</Th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono text-xs text-muted">{r.id}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{r.split} · {r.lang}</Td>
                  <Td>{r.message}</Td>
                  <Td align="center">{r.pass ? <CheckIcon className="inline text-ok" /> : <XIcon className="inline text-bad" />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </details>
      </Card>
    </>
  );
}
