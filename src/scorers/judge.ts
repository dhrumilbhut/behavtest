// Shared machinery for scorers that ask an LLM judge (llmJudge, faithfulness, contextRelevance):
// the provider call with its temperature fallback, JSON parsing that fails closed, the pre-run
// check, and the `{ judge, temperature }` metadata recorded with every verdict.
import { z } from "zod";
import { AdapterError, ConfigError, JudgeError, errorMessage } from "../core/errors.js";
import { withRetry } from "../core/retry.js";
import type { ScoreResult, ScoreRuntime, ScorerPreflightContext } from "../core/types.js";
import { callLlm, parseModelSpec, resolveApiKey, resolveBaseUrl, type LlmResult, type Provider } from "../llm/client.js";
import { computeCost } from "../pricing/cost.js";
import { buildJudgePrompt, JUDGE_SCHEMA } from "./judgePrompt.js";

const JUDGE_MAX_TOKENS = 2048;

/** The pass/fail verdict llmJudge and faithfulness (answer mode) ask for: reasoning first. */
export const verdictSchema = z.strictObject({ reasoning: z.string(), verdict: z.enum(["pass", "fail"]) });
const JUDGE_CHECK_TIMEOUT_MS = 60_000;

export interface JudgePrompt {
  system: string;
  user: string;
}

export interface JudgeSchema {
  name: string;
  schema: Record<string, unknown>;
}

/**
 * Judge endpoints (provider, base URL, model) seen rejecting `temperature`: newer reasoning models
 * accept only their default. They are asked again without it, and later calls skip the rejected try.
 */
const rejectsTemperature = new Set<string>();

function isTemperatureRejection(err: unknown): boolean {
  return err instanceof AdapterError && err.status === 400 && /temperature/i.test(err.message);
}

interface JudgeEndpoint {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

function judgeEndpoint(spec: string, env: Record<string, string | undefined>): JudgeEndpoint {
  const { provider, model } = parseModelSpec(spec, "judge model");
  return { provider, model, apiKey: resolveApiKey(provider, env), baseUrl: resolveBaseUrl(provider, env) };
}

/**
 * One judge request, with transport retries. Asks for temperature 0 unless the model rejects it.
 * `temperature` reports what the judge actually ran at.
 */
async function askJudge(
  ep: JudgeEndpoint,
  prompt: JudgePrompt,
  schema: JudgeSchema,
  signal: AbortSignal,
): Promise<{ res: LlmResult; temperature: 0 | "default" }> {
  const call = async (temperature: number | undefined) =>
    (
      await withRetry(
        () =>
          callLlm({
            ...ep,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            maxTokens: JUDGE_MAX_TOKENS,
            temperature,
            jsonSchema: schema,
            signal,
          }),
        { signal },
      )
    ).value;
  const endpoint = `${ep.provider} ${ep.baseUrl} ${ep.model}`;
  try {
    if (rejectsTemperature.has(endpoint)) return { res: await call(undefined), temperature: "default" };
    try {
      return { res: await call(0), temperature: 0 };
    } catch (err) {
      if (!isTemperatureRejection(err)) throw err;
      rejectsTemperature.add(endpoint);
      return { res: await call(undefined), temperature: "default" };
    }
  } catch (err) {
    if (err instanceof AdapterError) throw new JudgeError(`judge call failed: ${err.message}`, { cause: err });
    throw err;
  }
}

/** Parse the judge's JSON, tolerating a single surrounding ``` fence (some compatible servers add one). */
export function parseJudgeJson<T>(text: string, schema: z.ZodType<T>, what = "verdict"): T {
  let t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (fenced?.[1] !== undefined) t = fenced[1];
  let raw: unknown;
  try {
    raw = JSON.parse(t);
  } catch {
    throw new JudgeError(
      `judge did not return JSON (got: "${text.slice(0, 80).replace(/\s+/g, " ")}"). ` +
        "Does the judge provider support structured output?",
    );
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new JudgeError(`judge output did not match the ${what} schema: ${r.error.issues[0]?.message ?? "?"}`);
  return r.data;
}

function addCost(total: number | null | undefined, add: number | null): number | null {
  if (total === null || add === null) return null;
  return (total ?? 0) + add;
}

/**
 * Ask the judge one prompt and turn its structured answer into a score. A malformed answer is
 * retried once; anything that is not a valid answer fails closed (an error, never a pass). Every
 * result carries `{ judge, temperature }` metadata and the judge's cost.
 */
export async function runJudge<T>(opts: {
  spec: string | undefined;
  runtime: ScoreRuntime;
  prompt: JudgePrompt;
  schema: JudgeSchema;
  parse: (text: string) => T;
  toResult: (answer: T) => Omit<ScoreResult, "costUsd" | "metadata">;
}): Promise<ScoreResult> {
  const { spec, runtime } = opts;
  if (!spec) return { pass: false, value: null, error: "no judge model configured" };
  let cost: number | null = 0;
  const metadata: Record<string, unknown> = { judge: spec };
  try {
    const ep = judgeEndpoint(spec, runtime.env);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { res, temperature } = await askJudge(ep, opts.prompt, opts.schema, runtime.signal);
      metadata.temperature = temperature;
      cost = addCost(cost, computeCost(runtime.prices, ep.provider, ep.model, res.usage));
      if (res.refused) throw new JudgeError("judge refused to evaluate this output");
      let answer: T;
      try {
        answer = opts.parse(res.text);
      } catch (err) {
        lastError = err; // one retry on a malformed answer, then fail closed
        continue;
      }
      return { ...opts.toResult(answer), costUsd: cost, metadata };
    }
    throw lastError;
  } catch (err) {
    return { pass: false, value: null, error: errorMessage(err), costUsd: cost, metadata };
  }
}

/**
 * Ask the judge one trivial question before any case runs, so a judge that cannot work (unknown
 * model, bad key, no structured output) stops the run with a clear message instead of erroring
 * every attempt. Only the shape of the answer is checked, not the verdict.
 */
async function checkJudge(spec: string, env: Record<string, string | undefined>, runSignal?: AbortSignal): Promise<{ temperature: 0 | "default" }> {
  const timeout = AbortSignal.timeout(JUDGE_CHECK_TIMEOUT_MS);
  const signal = runSignal ? AbortSignal.any([runSignal, timeout]) : timeout;
  try {
    const prompt = buildJudgePrompt({ rubric: "Is the output the word OK?", input: "Reply with OK.", expected: "OK", output: "OK" });
    const { res, temperature } = await askJudge(judgeEndpoint(spec, env), prompt, { name: "verdict", schema: JUDGE_SCHEMA }, signal);
    if (res.refused) throw new JudgeError("the judge refused a trivial request");
    parseJudgeJson(res.text, verdictSchema);
    return { temperature };
  } catch (err) {
    throw new ConfigError(`The judge ${spec} does not work: ${errorMessage(err)}. Fix the judge configuration, or skip this check with --no-judge-check.`, {
      cause: err,
    });
  }
}

/** Judge checks already made in a run, shared by every judge scorer (keyed by the run's case list). */
const checksByRun = new WeakMap<object, Map<string, Promise<{ temperature: 0 | "default" }>>>();

/**
 * Preflight for a judge scorer: validate each case's config, require a judge model and its API key,
 * then (unless live checks are off) check each judge once per run and warn about judges that run
 * at their default temperature.
 */
export async function judgePreflight(
  name: string,
  ctx: ScorerPreflightContext,
  validate: (config: unknown) => { judge?: string } | string,
): Promise<void> {
  const users = ctx.cases.filter((c) => c.scorers.includes(name));
  if (users.length === 0) return;
  const specs = new Set<string>();
  for (const c of users) {
    const cfg = validate(c.scorerConfig?.[name] ?? {});
    if (typeof cfg === "string") throw new ConfigError(`case "${c.id}": ${cfg}`);
    const spec = cfg.judge ?? ctx.judge;
    if (!spec) {
      throw new ConfigError(
        `case "${c.id}" uses ${name} but no judge model is configured. Set "defaults.judge" in the suite, ` +
          'pass --judge, or export REGRADE_JUDGE (format "provider:model", e.g. "anthropic:claude-sonnet-5").',
      );
    }
    resolveApiKey(parseModelSpec(spec, "judge model").provider, ctx.env);
    specs.add(spec);
  }
  if (ctx.liveChecks === false) return;
  let checks = checksByRun.get(ctx.cases);
  if (!checks) checksByRun.set(ctx.cases, (checks = new Map()));
  await Promise.all(
    [...specs].map(async (spec) => {
      const first = !checks.has(spec);
      if (first) checks.set(spec, checkJudge(spec, ctx.env, ctx.signal));
      const { temperature } = await checks.get(spec)!;
      if (first && temperature === "default") {
        ctx.warn?.(
          `the judge ${spec} does not accept temperature 0, so it runs at its default temperature and its verdicts ` +
            "can vary between runs. Repeat cases (--repeat), or choose a judge that accepts temperature 0.",
        );
      }
    }),
  );
}
