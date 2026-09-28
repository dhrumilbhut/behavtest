import { z } from "zod";
import { ConfigError } from "../core/errors.js";
import { retrievedDocs } from "../core/trace.js";
import type { Scorer, ScoreResult } from "../core/types.js";

const configSchema = z.strictObject({
  /** hit: an expected document is in the top k; recall / precision at k; mrr: 1 / rank of the first expected document. */
  metric: z.enum(["hit", "recall", "precision", "mrr"]).default("hit"),
  /** Only the first k retrieved documents count (default: all of them). */
  k: z.number().int().min(1).optional(),
  /** Pass threshold for the metric's value, 0 to 1. Default 1 (required for precision). */
  min: z.number().min(0).max(1).optional(),
});
type Config = z.infer<typeof configSchema>;

function parse(config: unknown): Config | string {
  const r = configSchema.safeParse(config ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    return `invalid retrieval config: ${issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "?"}`;
  }
  if (r.data.metric === "precision" && r.data.min === undefined) {
    return 'invalid retrieval config: metric "precision" needs "min" (precision is below 1 whenever more documents are retrieved than expected)';
  }
  return r.data;
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

/**
 * Did the pipeline retrieve the documents it should have? Compares the ids in the attempt's
 * `retrieval` steps with the case's `expectedDocs`. Deterministic: no model involved.
 */
export const retrieval: Scorer = {
  name: "retrieval",

  preflight({ cases }) {
    for (const c of cases.filter((x) => x.scorers.includes("retrieval"))) {
      const cfg = parse(c.scorerConfig?.retrieval);
      if (typeof cfg === "string") throw new ConfigError(`case "${c.id}": ${cfg}`);
      if (!c.expectedDocs?.length) {
        throw new ConfigError(`case "${c.id}" uses the retrieval scorer but has no "expectedDocs" (the ids of the documents it should retrieve)`);
      }
    }
  },

  async score({ trace, expectedDocs, config }): Promise<ScoreResult> {
    const cfg = parse(config);
    if (typeof cfg === "string") return { pass: false, value: null, error: cfg };
    if (!expectedDocs?.length) return { pass: false, value: null, error: 'this case has no "expectedDocs" to compare with' };
    const docs = retrievedDocs(trace);
    if (!docs) {
      return { pass: false, value: null, error: 'the pipeline reported no retrieval step (return steps with kind "retrieval" whose output lists the documents)' };
    }
    const ids = docs.filter((d) => d.id !== undefined).map((d) => d.id!);
    if (docs.length > 0 && ids.length === 0) {
      return { pass: false, value: null, error: "the retrieved documents have no ids, so they cannot be matched with expectedDocs" };
    }

    const top = cfg.k === undefined ? ids : ids.slice(0, cfg.k);
    const expected = new Set(expectedDocs);
    const found = top.filter((id) => expected.has(id));
    const firstRank = top.findIndex((id) => expected.has(id)) + 1; // 0 when none
    const at = cfg.k === undefined ? "" : `@${cfg.k}`;
    let value: number;
    switch (cfg.metric) {
      case "hit":
        value = found.length > 0 ? 1 : 0;
        break;
      case "recall":
        value = found.length / expected.size;
        break;
      case "precision":
        value = top.length === 0 ? 0 : found.length / top.length;
        break;
      case "mrr":
        value = firstRank === 0 ? 0 : 1 / firstRank;
        break;
    }
    value = Math.round(value * 1000) / 1000;
    const min = cfg.min ?? 1;
    const ranked = top.map((id, i) => `${expected.has(id) ? "✓" : ""}${id}#${i + 1}`).join(", ") || "nothing";
    const missing = [...expected].filter((id) => !top.includes(id));
    const reasoning =
      `${cfg.metric}${at} = ${fmt(value)} (min ${fmt(min)}); retrieved ${ranked}` + (missing.length ? `; missing ${missing.join(", ")}` : "");
    return { pass: value >= min, value, reasoning };
  },
};
