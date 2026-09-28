import { z } from "zod";
import { ConfigError } from "../core/errors.js";
import type { AttemptRecord } from "../core/types.js";
import type { Store } from "../store/store.js";
import { cohensKappa, confusionOf, kappaInterval, type Confusion, type LabelPair } from "../stats/agreement.js";
import { wilsonInterval, type Proportion } from "../stats/wilson.js";

/** Fewer labels than this per group and the numbers are too uncertain to act on. */
export const MIN_LABELS = 30;

const labelSchema = z.strictObject({
  run: z.string().min(1),
  case: z.string().min(1),
  attempt: z.number().int().min(1).default(1),
  scorer: z.string().min(1).default("llmJudge"),
  label: z.enum(["pass", "fail"]),
  note: z.string().optional(),
});
export type Label = z.infer<typeof labelSchema>;

/** Parse a JSONL labels file: one `{ run, case, attempt?, scorer?, label, note? }` per line. Blank lines are ignored. */
export function parseLabels(text: string, source: string): Label[] {
  const labels: Label[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      problems.push(`line ${i + 1}: not valid JSON`);
      return;
    }
    const r = labelSchema.safeParse(raw);
    if (r.success) labels.push(r.data);
    else problems.push(`line ${i + 1}: ${r.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ")}`);
  });
  if (problems.length) {
    throw new ConfigError(`Invalid labels file ${source}:\n${problems.slice(0, 12).map((p) => `  - ${p}`).join("\n")}` + (problems.length > 12 ? `\n  - ...and ${problems.length - 12} more` : ""));
  }
  if (labels.length === 0) throw new ConfigError(`Labels file ${source} has no labels.`);
  return labels;
}

export interface CalibrationGroup {
  scorer: string;
  judge: string;
  rubric: string | null;
  n: number;
  confusion: Confusion;
  agreement: Proportion;
  kappa: number | null;
  kappaInterval: { lo: number; hi: number } | null;
  /** Of the answers the human failed, the fraction the judge passed. null when the human failed none. */
  falsePassRate: number | null;
  /** Of the answers the human passed, the fraction the judge failed. null when the human passed none. */
  falseFailRate: number | null;
  enoughLabels: boolean;
}

export interface CalibrationReport {
  schemaVersion: 1;
  labels: number;
  used: number;
  /** Labels that match no stored verdict (unknown run, case, attempt or scorer). */
  unmatched: Array<{ label: Label; reason: string }>;
  /** Labels on attempts where the scorer errored: there is no verdict to compare with. */
  onErrored: number;
  /** Labels repeated for the same verdict; the last one counts. */
  duplicates: number;
  groups: CalibrationGroup[];
}

/** Match labels with stored verdicts and measure how often the judge agrees with the human, per scorer, judge and rubric. */
export function calibrate(store: Store, labels: readonly Label[]): CalibrationReport {
  const runs = new Map<string, { runId: string; attempts: AttemptRecord[] } | string>();
  const loadRun = (ref: string) => {
    if (!runs.has(ref)) {
      try {
        const run = store.getRun(ref);
        runs.set(ref, run ? { runId: run.runId, attempts: store.getAttempts(run.runId) } : `no run matching "${ref}"`);
      } catch (err) {
        runs.set(ref, err instanceof Error ? err.message : String(err));
      }
    }
    return runs.get(ref)!;
  };

  // last label wins for the same verdict
  const byVerdict = new Map<string, { label: Label; judgePass: boolean; judge: string; rubric: string | null }>();
  const unmatched: CalibrationReport["unmatched"] = [];
  let onErrored = 0;
  let duplicates = 0;
  for (const label of labels) {
    const run = loadRun(label.run);
    if (typeof run === "string") {
      unmatched.push({ label, reason: run });
      continue;
    }
    const attempt = run.attempts.find((a) => a.caseId === label.case && a.attempt === label.attempt);
    if (!attempt) {
      unmatched.push({ label, reason: `run ${run.runId.slice(0, 8)} has no attempt ${label.attempt} of case "${label.case}"` });
      continue;
    }
    const score = attempt.scores.find((s) => s.scorerName === label.scorer);
    if (!score) {
      unmatched.push({ label, reason: `case "${label.case}" was not scored by ${label.scorer}` });
      continue;
    }
    if (score.error) {
      onErrored++;
      continue;
    }
    const key = `${run.runId}\0${label.case}\0${label.attempt}\0${label.scorer}`;
    if (byVerdict.has(key)) duplicates++;
    const rubric = typeof score.config?.rubric === "string" ? score.config.rubric : typeof score.config?.mode === "string" ? `mode: ${score.config.mode}` : null;
    const judge = typeof score.metadata?.judge === "string" ? score.metadata.judge : "unknown judge";
    byVerdict.set(key, { label, judgePass: score.pass, judge, rubric });
  }

  const groups = new Map<string, { scorer: string; judge: string; rubric: string | null; pairs: LabelPair[] }>();
  for (const v of byVerdict.values()) {
    const key = `${v.label.scorer}\0${v.judge}\0${v.rubric ?? ""}`;
    if (!groups.has(key)) groups.set(key, { scorer: v.label.scorer, judge: v.judge, rubric: v.rubric, pairs: [] });
    groups.get(key)!.pairs.push([v.judgePass, v.label.label === "pass"]);
  }

  return {
    schemaVersion: 1,
    labels: labels.length,
    used: byVerdict.size,
    unmatched,
    onErrored,
    duplicates,
    groups: [...groups.values()]
      .sort((a, b) => b.pairs.length - a.pairs.length || a.scorer.localeCompare(b.scorer) || a.judge.localeCompare(b.judge) || (a.rubric ?? "").localeCompare(b.rubric ?? ""))
      .map((g) => {
        const c = confusionOf(g.pairs);
        const n = g.pairs.length;
        const humanFail = c.falsePass + c.agreeFail;
        const humanPass = c.agreePass + c.falseFail;
        return {
          scorer: g.scorer,
          judge: g.judge,
          rubric: g.rubric,
          n,
          confusion: c,
          agreement: wilsonInterval(c.agreePass + c.agreeFail, n),
          kappa: cohensKappa(c),
          kappaInterval: kappaInterval(g.pairs),
          falsePassRate: humanFail === 0 ? null : c.falsePass / humanFail,
          falseFailRate: humanPass === 0 ? null : c.falseFail / humanPass,
          enoughLabels: n >= MIN_LABELS,
        };
      }),
  };
}

export interface CalibrationGate {
  failed: boolean;
  reasons: string[];
}

/** `--min-kappa`: every group needs enough labels and kappa at or above the threshold. */
export function calibrationGate(report: CalibrationReport, minKappa: number): CalibrationGate {
  const reasons: string[] = [];
  if (report.groups.length === 0) reasons.push("no labels matched a stored verdict");
  for (const g of report.groups) {
    const name = `${g.scorer} (${g.judge}${g.rubric ? `, ${g.rubric.slice(0, 40)}` : ""})`;
    if (!g.enoughLabels) reasons.push(`${name}: ${g.n} labels, fewer than the ${MIN_LABELS} needed`);
    else if (g.kappa === null) reasons.push(`${name}: kappa is undefined (every label and verdict is the same)`);
    else if (g.kappa < minKappa) reasons.push(`${name}: kappa ${g.kappa.toFixed(2)} is below ${minKappa}`);
  }
  return { failed: reasons.length > 0, reasons };
}
