import { randomUUID } from "node:crypto";
import { ConfigError } from "./errors.js";
import type { RunReporter } from "../report/types.js";
import { runSuite, type RunOptions, type RunOutcome } from "./runner.js";
import type { SuiteVariant, TestSuite } from "./types.js";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Merge `over` onto `base`: nested plain objects are merged, everything else (arrays included) is replaced. */
export function mergeConfig(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = isPlainObject(b) && isPlainObject(v) ? mergeConfig(b, v) : v;
  }
  return out;
}

/**
 * The suite as one variant runs it: the variant's pipeline applied and `variants` removed. A variant with a
 * different adapter replaces the config (another adapter's settings would not make sense merged).
 */
export function resolveVariant(suite: TestSuite, variant: SuiteVariant): TestSuite {
  const { variants: _variants, ...rest } = suite;
  const adapter = variant.pipeline?.adapter ?? suite.pipeline.adapter;
  const over = variant.pipeline?.config ?? {};
  const config = adapter === suite.pipeline.adapter ? mergeConfig(suite.pipeline.config, over) : over;
  return { ...rest, pipeline: { adapter, config } };
}

/** The variants to run: all of them, or the named ones (in the suite's order). */
export function selectVariants(suite: TestSuite, names?: readonly string[]): SuiteVariant[] {
  const all = suite.variants ?? [];
  if (!names || names.length === 0) return all;
  if (all.length === 0) throw new ConfigError(`--variant: suite "${suite.name}" has no variants.`);
  const known = new Set(all.map((v) => v.name));
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    throw new ConfigError(`--variant: unknown variant${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")} (suite has: ${[...known].join(", ")})`);
  }
  return all.filter((v) => names.includes(v.name));
}

export interface MatrixRunOptions extends Omit<RunOptions, "reporter"> {
  /** Only these variants (default: all). */
  variants?: string[];
  /** A reporter per variant run (the console reporter prints one run). */
  reporterFor?: (variant: SuiteVariant, index: number) => RunReporter | undefined;
}

export interface MatrixOutcome {
  matrixId: string;
  runs: Array<RunOutcome & { variant: string }>;
  /** 130 if interrupted; otherwise the worst variant's code (0 all passed, 1 any failure). */
  exitCode: 0 | 1 | 130;
}

/**
 * Run a suite once per variant, one after another, as ordinary runs grouped by a matrix id. The judge is the
 * same for every variant (a variant cannot change it), so it is checked once, before the first.
 */
export async function runMatrix(opts: MatrixRunOptions): Promise<MatrixOutcome> {
  const variants = selectVariants(opts.suite, opts.variants);
  if (variants.length === 0) throw new ConfigError(`Suite "${opts.suite.name}" has no variants to run.`);
  const matrixId = randomUUID();
  const runs: MatrixOutcome["runs"] = [];
  for (const [i, variant] of variants.entries()) {
    if (opts.signal?.aborted) break;
    const overrides = { ...opts.overrides, matrixId, variant: variant.name, ...(i > 0 ? { judgeCheck: false } : {}) };
    const outcome = await runSuite({ ...opts, suite: resolveVariant(opts.suite, variant), overrides, reporter: opts.reporterFor?.(variant, i) });
    runs.push({ ...outcome, variant: variant.name });
    if (outcome.exitCode === 130) break;
  }
  const interrupted = runs.some((r) => r.exitCode === 130) || runs.length < variants.length;
  return { matrixId, runs, exitCode: interrupted ? 130 : runs.some((r) => r.exitCode === 1) ? 1 : 0 };
}
