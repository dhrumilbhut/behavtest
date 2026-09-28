import { z } from "zod";
import { JudgeError } from "../core/errors.js";
import { retrievedDocs } from "../core/trace.js";
import type { Scorer, ScoreArgs, ScoreResult } from "../core/types.js";
import { judgePreflight, parseJudgeJson, runJudge, verdictSchema } from "./judge.js";
import {
  buildRagPrompt,
  claimsSchemaFor,
  relevanceSchemaFor,
  CONTEXT_RELEVANCE_SYSTEM,
  FAITHFULNESS_CLAIMS_SYSTEM,
  FAITHFULNESS_VERDICT_SYSTEM,
  JUDGE_SCHEMA,
  type ContextDoc,
} from "./judgePrompt.js";

const faithfulnessConfig = z.strictObject({
  judge: z.string().min(1).optional(),
  /** "answer": one verdict on the whole answer. "claims": each claim checked, in the same single call. */
  mode: z.enum(["answer", "claims"]).default("answer"),
  /** claims mode: the fraction of claims that must be supported (default 1: all of them). */
  min: z.number().min(0).max(1).optional(),
});

const relevanceConfig = z.strictObject({
  judge: z.string().min(1).optional(),
  /** Fraction of retrieved documents that must be relevant. Default: at least one. */
  min: z.number().min(0).max(1).optional(),
});

function parser<T>(name: string, schema: z.ZodType<T>) {
  return (config: unknown): T | string => {
    const r = schema.safeParse(config ?? {});
    if (r.success) return r.data;
    const issue = r.error.issues[0];
    return `invalid ${name} config: ${issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "?"}`;
  };
}
const parseFaithfulness = parser("faithfulness", faithfulnessConfig);
const parseRelevance = parser("contextRelevance", relevanceConfig);

/** The attempt's retrieved documents, or an error result when there are none to judge. */
function contextOf(trace: ScoreArgs["trace"]): ContextDoc[] | ScoreResult {
  const docs = retrievedDocs(trace);
  if (!docs) {
    return { pass: false, value: null, error: 'the pipeline reported no retrieval step (return steps with kind "retrieval" whose output lists the documents)' };
  }
  if (docs.length > 0 && docs.every((d) => d.text === undefined)) {
    return { pass: false, value: null, error: "the retrieved documents have no text, so the judge cannot read them (include text or content in the retrieval step's output)" };
  }
  return docs;
}
const isResult = (v: unknown): v is ScoreResult => !Array.isArray(v);

const claimsSchema = z.strictObject({
  claims: z.array(z.strictObject({ claim: z.string(), supported: z.boolean(), source: z.string().nullable() })),
});
const relevanceSchema = z.strictObject({
  documents: z.array(z.strictObject({ id: z.string(), relevant: z.boolean(), reason: z.string() })),
});

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
const quote = (s: string) => `"${s.length > 120 ? `${s.slice(0, 117)}...` : s}"`;

/**
 * Is the answer supported by what was retrieved? Catches answers that add facts the documents do
 * not contain (hallucination), even when they sound right. Needs the attempt's retrieval steps.
 */
export const faithfulness: Scorer = {
  name: "faithfulness",
  usesJudge: true,

  preflight: (ctx) => judgePreflight("faithfulness", ctx, parseFaithfulness),

  async score({ output, trace, config, runtime }) {
    const cfg = parseFaithfulness(config);
    if (typeof cfg === "string") return { pass: false, value: null, error: cfg };
    const docs = contextOf(trace);
    if (isResult(docs)) return docs;
    const spec = cfg.judge ?? runtime.judge;

    if (cfg.mode === "answer") {
      const prompt = buildRagPrompt({ system: FAITHFULNESS_VERDICT_SYSTEM, docs, answer: output });
      return runJudge({
        spec,
        runtime,
        prompt,
        schema: { name: "verdict", schema: JUDGE_SCHEMA },
        parse: (text) => parseJudgeJson(text, verdictSchema),
        toResult: (v) => ({ pass: v.verdict === "pass", value: v.verdict === "pass" ? 1 : 0, reasoning: v.reasoning }),
      });
    }

    const min = cfg.min ?? 1;
    const prompt = buildRagPrompt({ system: FAITHFULNESS_CLAIMS_SYSTEM, docs, answer: output });
    return runJudge({
      spec,
      runtime,
      prompt,
      schema: { name: "claims", schema: claimsSchemaFor(prompt.ids) },
      parse: (text) => parseJudgeJson(text, claimsSchema, "claims"),
      toResult: ({ claims }) => {
        if (claims.length === 0) return { pass: true, value: 1, reasoning: "the answer makes no factual claims" };
        const supported = claims.filter((c) => c.supported);
        const value = Math.round((supported.length / claims.length) * 1000) / 1000;
        const unsupported = claims.filter((c) => !c.supported).map((c) => quote(c.claim));
        const sources = [...new Set(supported.map((c) => c.source).filter((s): s is string => !!s))];
        const reasoning =
          `${supported.length}/${claims.length} claims supported (min ${fmt(min)})` +
          (unsupported.length ? `; unsupported: ${unsupported.join("; ")}` : "") +
          (sources.length ? `; sources: ${sources.join(", ")}` : "");
        return { pass: value >= min, value, reasoning };
      },
    });
  },
};

/**
 * Were the retrieved documents relevant to the question? The judge rates each document; the value
 * is the relevant fraction. Catches a retriever that returns noise even when the answer looks fine.
 */
export const contextRelevance: Scorer = {
  name: "contextRelevance",
  usesJudge: true,

  preflight: (ctx) => judgePreflight("contextRelevance", ctx, parseRelevance),

  async score({ input, trace, config, runtime }) {
    const cfg = parseRelevance(config);
    if (typeof cfg === "string") return { pass: false, value: null, error: cfg };
    const docs = contextOf(trace);
    if (isResult(docs)) return docs;
    if (docs.length === 0) return { pass: false, value: 0, reasoning: "nothing was retrieved" };

    const prompt = buildRagPrompt({ system: CONTEXT_RELEVANCE_SYSTEM, question: input, docs });
    return runJudge({
      spec: cfg.judge ?? runtime.judge,
      runtime,
      prompt,
      schema: { name: "relevance", schema: relevanceSchemaFor(prompt.ids) },
      parse: (text) => {
        const answer = parseJudgeJson(text, relevanceSchema, "relevance");
        const rated = new Map(answer.documents.map((d) => [d.id, d]));
        const missing = prompt.ids.filter((id) => !rated.has(id));
        if (missing.length) throw new JudgeError(`judge did not rate document${missing.length > 1 ? "s" : ""} ${missing.join(", ")}`);
        return prompt.ids.map((id) => rated.get(id)!);
      },
      toResult: (rated) => {
        const relevant = rated.filter((d) => d.relevant);
        const value = Math.round((relevant.length / rated.length) * 1000) / 1000;
        const pass = cfg.min === undefined ? relevant.length > 0 : value >= cfg.min;
        const reasoning =
          `${relevant.length}/${rated.length} documents relevant` +
          (cfg.min === undefined ? " (min: at least one)" : ` (min ${fmt(cfg.min)})`) +
          `; ${rated.map((d) => `${d.relevant ? "✓" : "✗"}${d.id}: ${d.reason}`).join("; ")}`;
        return { pass, value, reasoning };
      },
    });
  },
};
