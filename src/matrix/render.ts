import pc from "picocolors";
import type { CaseVerdict } from "../core/types.js";
import { formatMs, formatUsd } from "../report/console.js";
import { pctWithInterval, points } from "../report/format.js";
import type { MatrixReport, MatrixVariant } from "./matrix.js";

const VERDICT_TEXT = {
  "significant-regression": "significantly worse",
  "significant-improvement": "significantly better",
  "not-significant": "not significant",
  "no-comparable-cases": "no comparable cases",
} as const;

function costText(v: MatrixVariant): string {
  const c = v.summary.costUsd;
  if (v.summary.attempts.total > 0 && c.unknownAttempts === v.summary.attempts.total) return "unknown";
  return formatUsd(c.pipeline + c.judge) + (c.unknownAttempts > 0 ? "+" : "");
}

/** "+8.3 pts [-2.1, +18.0] p=0.21 not significant" */
export function vsReferenceText(v: MatrixVariant): string {
  const r = v.vsReference;
  if (!r) return "reference";
  if (r.meanDelta === null) return VERDICT_TEXT[r.verdict];
  const ci = r.ci ? ` [${points(r.ci.lo)}, ${points(r.ci.hi)}]` : "";
  const p = r.pValue === null ? "" : ` p=${r.pValue < 0.0001 ? "<0.0001" : r.pValue.toFixed(3)}`;
  return `${points(r.meanDelta)}${ci}${p} ${VERDICT_TEXT[r.verdict]}`;
}

const cellText = (c: { passed: number; attempts: number } | null) => (c ? `${c.passed}/${c.attempts}` : "–");

function table(rows: string[][], align: Array<"l" | "r">): string[] {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((cell, i) => (align[i] === "r" ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!))).join("  ").trimEnd());
}

export interface MatrixRenderOptions {
  color?: boolean;
  ascii?: boolean;
}

export function renderMatrixConsole(m: MatrixReport, opts: MatrixRenderOptions = {}): string {
  const c = pc.createColors(opts.color ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));
  const ascii = opts.ascii ?? Boolean(process.env.REGRADE_ASCII);
  const mark: Record<CaseVerdict, string> = ascii
    ? { passed: "ok", failed: "FAIL", flaky: "~", errored: "ERR" }
    : { passed: "✓", failed: "✗", flaky: "~", errored: "!" };
  const paint: Record<CaseVerdict, (s: string) => string> = { passed: c.green, failed: c.red, flaky: c.yellow, errored: c.yellow };
  const dot = ascii ? "-" : "·";
  const out: string[] = [];
  out.push(`${c.bold("regrade matrix")} ${dot} ${m.suiteName} ${dot} ${m.variants.length} variant${m.variants.length === 1 ? "" : "s"} ${dot} matrix ${m.matrixId.slice(0, 8)}`);
  for (const w of m.warnings) out.push(`  ${c.yellow("warning:")} ${w}`);
  out.push("");

  const head = ["variant", "pipeline", "attempt pass rate [95% CI]", "cases passed", "flaky", "p95 latency", "cost", `vs ${m.reference}`];
  const rows = m.variants.map((v) => [
    v.variant === m.reference ? `${v.variant} *` : v.variant,
    v.pipeline,
    v.attemptRate ? pctWithInterval(v.attemptRate) : "–",
    `${v.summary.cases.passed}/${v.summary.cases.total}`,
    String(v.summary.cases.flaky),
    v.summary.latency ? formatMs(v.summary.latency.p95Ms) : "–",
    costText(v),
    vsReferenceText(v),
  ]);
  const lines = table([head, ...rows], ["l", "l", "l", "r", "r", "r", "r", "l"]);
  out.push(`  ${c.dim(lines[0]!)}`);
  lines.slice(1).forEach((l, i) => {
    const r = m.variants[i]!.vsReference;
    const colored = r?.verdict === "significant-regression" ? c.red(l) : r?.verdict === "significant-improvement" ? c.green(l) : l;
    out.push(`  ${colored}`);
  });
  out.push(c.dim(`  * reference. "vs" is the mean change in pass rate per case, with a 95% interval and a case-stratified permutation test.`));
  out.push("");

  const grid = table(
    [["case", ...m.variants.map((v) => v.variant)], ...m.cases.map((k) => [k.caseId, ...k.cells.map((cell) => (cell ? `${cellText(cell)} ${mark[cell.verdict]}` : "–"))])],
    ["l", ...m.variants.map(() => "r" as const)],
  );
  out.push(`  ${c.dim(grid[0]!)}`);
  grid.slice(1).forEach((l, i) => {
    const k = m.cases[i]!;
    const differs = new Set(k.cells.map((cell) => cell?.verdict ?? "none")).size > 1;
    out.push(`  ${differs ? l : c.dim(l)}`);
  });
  const legend = (["passed", "flaky", "failed", "errored"] as const).map((v) => `${paint[v](mark[v])} ${v}`).join("  ");
  out.push(c.dim(`  passed/attempts per variant · ${legend} · rows that differ between variants are highlighted`));
  return `${out.join("\n")}\n`;
}

export function renderMatrixMarkdown(m: MatrixReport): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const lines = [
    `## Regrade matrix: ${esc(m.suiteName)}`,
    "",
    `${m.variants.length} variant${m.variants.length === 1 ? "" : "s"}, matrix \`${m.matrixId.slice(0, 8)}\`, compared with **${esc(m.reference)}**.`,
    "",
    ...m.warnings.map((w) => `> **Warning:** ${w}`),
    ...(m.warnings.length ? [""] : []),
    `| Variant | Pipeline | Attempt pass rate [95% CI] | Cases passed | Flaky | p95 latency | Cost | vs ${esc(m.reference)} |`,
    "|---|---|---|---:|---:|---:|---:|---|",
    ...m.variants.map(
      (v) =>
        `| ${esc(v.variant)}${v.variant === m.reference ? " (reference)" : ""} | \`${esc(v.pipeline)}\` | ${v.attemptRate ? pctWithInterval(v.attemptRate) : "–"} | ${v.summary.cases.passed}/${v.summary.cases.total} | ${v.summary.cases.flaky} | ${v.summary.latency ? formatMs(v.summary.latency.p95Ms) : "–"} | ${costText(v)} | ${v.vsReference ? esc(vsReferenceText(v)) : "–"} |`,
    ),
    "",
    "<details><summary>Cases</summary>",
    "",
    `| Case | ${m.variants.map((v) => esc(v.variant)).join(" | ")} |`,
    `|---|${m.variants.map(() => "---:").join("|")}|`,
    ...m.cases.map((k) => `| \`${esc(k.caseId)}\` | ${k.cells.map((cell) => (cell ? `${cellText(cell)} ${cell.verdict}` : "–")).join(" | ")} |`),
    "",
    "</details>",
    "",
  ];
  return lines.join("\n");
}

/** Best variant by attempt pass rate (ties: the cheaper), for one-line summaries. */
export function bestVariant(m: MatrixReport): MatrixVariant | undefined {
  return [...m.variants]
    .filter((v) => v.attemptRate)
    .sort((a, b) => b.attemptRate!.rate - a.attemptRate!.rate || a.summary.costUsd.pipeline - b.summary.costUsd.pipeline)[0];
}

