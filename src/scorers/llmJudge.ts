import { z } from "zod";
import type { Scorer } from "../core/types.js";
import { judgePreflight, parseJudgeJson, runJudge, verdictSchema } from "./judge.js";
import { buildJudgePrompt, DEFAULT_RUBRIC, JUDGE_SCHEMA } from "./judgePrompt.js";

const configSchema = z.object({
  judge: z.string().min(1).optional(),
  rubric: z.string().min(1).optional(),
});

function parseConfig(config: unknown): z.infer<typeof configSchema> | string {
  const cfg = configSchema.safeParse(config ?? {});
  return cfg.success ? cfg.data : `invalid llmJudge config: ${cfg.error.issues[0]?.message ?? "?"}`;
}

/**
 * LLM-as-judge. The pipeline output is untrusted text, so it is fenced with a
 * per-call random token, the judge is told to treat it as data, native
 * structured output is requested, and anything that is not a valid verdict
 * fails closed (an error, never an implicit pass). Temperature 0 is requested, except from models
 * that reject it, which are judged at their default temperature.
 */
export const llmJudge: Scorer = {
  name: "llmJudge",
  usesJudge: true,

  preflight: (ctx) => judgePreflight("llmJudge", ctx, parseConfig),

  async score({ input, expected, output, config, runtime }) {
    const cfg = parseConfig(config);
    if (typeof cfg === "string") return { pass: false, value: null, error: cfg };
    return runJudge({
      spec: cfg.judge ?? runtime.judge,
      runtime,
      prompt: buildJudgePrompt({ rubric: cfg.rubric ?? DEFAULT_RUBRIC, input, expected, output }),
      schema: { name: "verdict", schema: JUDGE_SCHEMA },
      parse: (text) => parseJudgeJson(text, verdictSchema),
      toResult: (v) => ({ pass: v.verdict === "pass", value: v.verdict === "pass" ? 1 : 0, reasoning: v.reasoning }),
    });
  },
};
