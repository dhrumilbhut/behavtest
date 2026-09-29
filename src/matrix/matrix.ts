import { ConfigError } from "../core/errors.js";
import type { AttemptRecord, CaseVerdict, RunRecord, RunSummary } from "../core/types.js";
import { groupCases, summarize } from "../core/verdict.js";
import { compareRuns, type Comparison, type OverallVerdict } from "../stats/compare.js";
import { wilsonInterval, type Proportion } from "../stats/wilson.js";
import type { MatrixSummary, Store } from "../store/store.js";

export interface MatrixVariant {
  variant: string;
  runId: string;
  status: RunRecord["status"];
  startedAt: string;
  label: string | null;
  gitSha: string | null;
  /** e.g. "openai:gpt-5.4-nano" or the adapter name. */
  pipeline: string;
  summary: RunSummary;
  /** Attempt pass rate over attempts with a verdict (errored attempts excluded), with its Wilson interval. */
  attemptRate: Proportion | null;
  /** This variant against the reference (null for the reference itself). */
  vsReference: {
    comparableCases: number;
    meanDelta: number | null;
    ci: { lo: number; hi: number } | null;
    pValue: number | null;
    verdict: OverallVerdict;
    regressed: number;
    improved: number;
  } | null;
}

export interface MatrixCell {
  passed: number;
  attempts: number;
  verdict: CaseVerdict;
}

export interface MatrixReport {
  schemaVersion: 1;
  matrixId: string;
  suiteName: string;
  startedAt: string;
  reference: string;
  variants: MatrixVariant[];
  /** One row per case (in the order the reference ran them); cells follow `variants`, null when a variant has no attempts of the case. */
  cases: Array<{ caseId: string; cells: Array<MatrixCell | null> }>;
  warnings: string[];
}

export interface LoadedMatrixRun {
  variant: string;
  run: RunRecord;
  attempts: readonly AttemptRecord[];
}

function pipelineName(run: RunRecord): string {
  const p = run.pipeline as { adapter?: unknown; config?: { model?: unknown } };
  const adapter = typeof p.adapter === "string" ? p.adapter : "pipeline";
  // provider adapters name their model; other pipelines are named by the adapter itself
  return (adapter === "openai" || adapter === "anthropic") && typeof p.config?.model === "string" ? `${adapter}:${p.config.model}` : adapter;
}

/** Compare the variants of a matrix: each one's pass rate and costs, a case grid, and each variant against the reference. */
export function buildMatrix(matrixId: string, runs: readonly LoadedMatrixRun[], reference?: string): MatrixReport {
  if (runs.length === 0) throw new ConfigError(`Matrix ${matrixId.slice(0, 8)} has no runs.`);
  const refName = reference ?? runs[0]!.variant;
  const ref = runs.find((r) => r.variant === refName);
  if (!ref) throw new ConfigError(`--reference: no variant "${refName}" in this matrix (it has: ${runs.map((r) => r.variant).join(", ")}).`);

  const warnings: string[] = [];
  for (const r of runs) if (r.run.status !== "completed") warnings.push(`variant "${r.variant}" is ${r.run.status}: its results may be partial.`);
  const judges = new Set(runs.map((r) => String((r.run.pipeline as { judge?: unknown }).judge ?? "")));
  if (judges.size > 1) warnings.push("the variants were judged by different judge models, so judged scores are not directly comparable.");

  const variants: MatrixVariant[] = runs.map((r) => {
    const summary = r.run.summary ?? summarize([...r.attempts]);
    const scored = summary.attempts.passed + summary.attempts.failed;
    let vsReference: MatrixVariant["vsReference"] = null;
    if (r !== ref) {
      const c: Comparison = compareRuns({ base: ref, head: r });
      vsReference = {
        comparableCases: c.overall.comparableCases,
        meanDelta: c.overall.meanDelta,
        ci: c.overall.ci,
        pValue: c.overall.pValue,
        verdict: c.overall.verdict,
        regressed: c.counts.regressed,
        improved: c.counts.improved,
      };
    }
    return {
      variant: r.variant,
      runId: r.run.runId,
      status: r.run.status,
      startedAt: r.run.startedAt,
      label: r.run.label,
      gitSha: r.run.gitSha,
      pipeline: pipelineName(r.run),
      summary,
      attemptRate: scored > 0 ? wilsonInterval(summary.attempts.passed, scored) : null,
      vsReference,
    };
  });

  const byVariant = runs.map((r) => new Map(groupCases([...r.attempts]).map((c) => [c.caseId, c])));
  const ids: string[] = [];
  for (const m of [byVariant[runs.indexOf(ref)]!, ...byVariant]) for (const id of m.keys()) if (!ids.includes(id)) ids.push(id);
  const cases = ids.map((caseId) => ({
    caseId,
    cells: byVariant.map((m) => {
      const c = m.get(caseId);
      return c ? { passed: c.attempts.filter((a) => a.status === "passed").length, attempts: c.attempts.length, verdict: c.verdict } : null;
    }),
  }));

  return { schemaVersion: 1, matrixId, suiteName: runs[0]!.run.suiteName, startedAt: runs[0]!.run.startedAt, reference: refName, variants, cases, warnings };
}

/** Load a matrix's runs from a store. */
export function loadMatrix(store: Store, matrix: MatrixSummary): LoadedMatrixRun[] {
  return matrix.variants.flatMap((v) => {
    const run = store.getRun(v.runId);
    return run ? [{ variant: v.variant, run, attempts: store.getAttempts(run.runId) }] : [];
  });
}

/** Find a matrix by id prefix, or the latest (optionally of one suite). */
export function pickMatrix(store: Store, ref: string | undefined, suite?: string): MatrixSummary {
  if (!store.getMatrix || !store.listMatrices) throw new ConfigError("This results store does not keep matrices.");
  if (ref) {
    const m = store.getMatrix(ref);
    if (!m) throw new ConfigError(`No matrix matching "${ref}". Run a suite that has "variants", or list matrices with \`behavtest matrix --list\`.`);
    return m;
  }
  // the latest with two or more variants: `run --variant x` makes a one-variant matrix, which compares nothing
  const recent = store.listMatrices({ suiteName: suite, limit: 50 });
  const latest = recent.find((m) => m.variants.length > 1) ?? recent[0];
  if (!latest) {
    throw new ConfigError(
      suite ? `No matrix runs of suite "${suite}" yet.` : 'No matrix runs yet. Add "variants" to a suite and run it: each variant becomes one run of the matrix.',
    );
  }
  return latest;
}
