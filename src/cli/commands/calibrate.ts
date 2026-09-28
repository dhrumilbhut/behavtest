import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { calibrate, calibrationGate, MIN_LABELS, parseLabels, type CalibrationGate, type CalibrationGroup, type CalibrationReport } from "../../calibration/calibrate.js";
import { ConfigError, errorMessage } from "../../core/errors.js";
import { pct, pctWithInterval } from "../../report/format.js";
import { colorFor, openExistingStore } from "./common.js";

export interface CalibrateOptions {
  labels: string;
  db?: string;
  minKappa?: number;
  json?: string;
  md?: string;
  color?: boolean;
}

const k2 = (x: number) => x.toFixed(2);
const kappaText = (g: CalibrationGroup) =>
  g.kappa === null ? "undefined" : `${k2(g.kappa)}${g.kappaInterval ? ` [${k2(g.kappaInterval.lo)}, ${k2(g.kappaInterval.hi)}]` : ""}`;
const rubricText = (g: CalibrationGroup) => (g.rubric ? (g.rubric.length > 70 ? `"${g.rubric.slice(0, 67)}..."` : `"${g.rubric}"`) : "default rubric");

/** How to read kappa, in words (Landis & Koch's widely used bands). */
function kappaWords(k: number | null): string {
  if (k === null) return "cannot be computed";
  if (k < 0.2) return "slight agreement beyond chance";
  if (k < 0.4) return "fair agreement";
  if (k < 0.6) return "moderate agreement";
  if (k < 0.8) return "substantial agreement";
  return "almost perfect agreement";
}

export function renderCalibration(report: CalibrationReport, gate: CalibrationGate | undefined, color?: boolean): string {
  const c = colorFor(color);
  const out: string[] = [];
  const skipped = [
    report.unmatched.length ? `${report.unmatched.length} unmatched` : "",
    report.onErrored ? `${report.onErrored} on errored verdicts` : "",
    report.duplicates ? `${report.duplicates} duplicates (last one counts)` : "",
  ].filter(Boolean);
  out.push(`${c.bold("regrade calibrate")} · ${report.labels} labels, ${report.used} matched${skipped.length ? ` · ${skipped.join(" · ")}` : ""}`);
  for (const u of report.unmatched.slice(0, 5)) out.push(c.dim(`  unmatched: run ${u.label.run} case ${u.label.case} #${u.label.attempt}: ${u.reason}`));
  if (report.unmatched.length > 5) out.push(c.dim(`  ...and ${report.unmatched.length - 5} more unmatched`));
  for (const g of report.groups) {
    const cf = g.confusion;
    out.push("");
    out.push(`  ${c.bold(g.scorer)} · judge ${g.judge} · ${rubricText(g)}`);
    out.push(`    labels ${g.n}   agreement ${pctWithInterval(g.agreement)}   kappa ${kappaText(g)}  ${c.dim(`(${kappaWords(g.kappa)})`)}`);
    const fp = g.falsePassRate === null ? "" : `judge passed ${cf.falsePass} of ${cf.falsePass + cf.agreeFail} answers you failed (false pass ${pct(g.falsePassRate)})`;
    const ff = g.falseFailRate === null ? "" : `failed ${cf.falseFail} of ${cf.falseFail + cf.agreePass} you passed (false fail ${pct(g.falseFailRate)})`;
    out.push(`    ${[fp, ff].filter(Boolean).join(" · ")}`);
    out.push(c.dim(`                 you: pass  you: fail`));
    out.push(c.dim(`    judge pass   ${String(cf.agreePass).padStart(9)}  ${String(cf.falsePass).padStart(9)}`));
    out.push(c.dim(`    judge fail   ${String(cf.falseFail).padStart(9)}  ${String(cf.agreeFail).padStart(9)}`));
    if (!g.enoughLabels) out.push(c.yellow(`    ! only ${g.n} labels: with fewer than ${MIN_LABELS}, these numbers are too uncertain to act on`));
  }
  if (report.groups.length === 0) out.push("", c.yellow("  No labels matched a stored verdict."));
  if (gate) {
    out.push("");
    out.push(gate.failed ? c.red(`  Gate failed: ${gate.reasons.join("; ")}`) : c.green("  Gate passed: the judge agrees with your labels well enough."));
  }
  return `${out.join("\n")}\n`;
}

export function renderCalibrationMarkdown(report: CalibrationReport, gate: CalibrationGate | undefined): string {
  const rows = report.groups.map((g) =>
    `| ${g.scorer} | ${g.judge} | ${rubricText(g).replace(/\|/g, "\\|")} | ${g.n} | ${pctWithInterval(g.agreement)} | ${kappaText(g)} | ${g.falsePassRate === null ? "–" : pct(g.falsePassRate)} | ${g.falseFailRate === null ? "–" : pct(g.falseFailRate)} |`,
  );
  return [
    "## Regrade judge calibration",
    "",
    `${report.labels} labels, ${report.used} matched to stored verdicts.`,
    "",
    "| Scorer | Judge | Rubric | Labels | Agreement | Kappa [95% CI] | False pass | False fail |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    ...(gate ? [gate.failed ? `**Gate failed:** ${gate.reasons.join("; ")}` : "**Gate passed.**", ""] : []),
  ].join("\n");
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

/** Returns the exit code: 0, or 1 when --min-kappa is given and the gate fails. */
export function calibrateCommand(o: CalibrateOptions): number {
  let text: string;
  try {
    text = readFileSync(o.labels, "utf8");
  } catch (err) {
    throw new ConfigError(`Cannot read labels file "${o.labels}": ${errorMessage(err)}`);
  }
  const labels = parseLabels(text, `"${o.labels}"`);
  const store = openExistingStore(o.db);
  try {
    const report = calibrate(store, labels);
    const gate = o.minKappa === undefined ? undefined : calibrationGate(report, o.minKappa);
    process.stdout.write(renderCalibration(report, gate, o.color === false ? false : undefined));
    if (o.json) {
      write(o.json, `${JSON.stringify({ ...report, gate: gate ?? null }, null, 2)}\n`);
      process.stdout.write(`  json → ${o.json}\n`);
    }
    if (o.md) {
      write(o.md, renderCalibrationMarkdown(report, gate));
      process.stdout.write(`  markdown → ${o.md}\n`);
    }
    return gate?.failed ? 1 : 0;
  } finally {
    store.close();
  }
}
