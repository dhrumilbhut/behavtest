import { mulberry32 } from "./bootstrap.js";

/** Judge verdicts against human labels. "pass"/"fail" are the human's. */
export interface Confusion {
  /** judge pass, human pass */
  agreePass: number;
  /** judge fail, human fail */
  agreeFail: number;
  /** judge pass, human fail: the judge let a bad answer through */
  falsePass: number;
  /** judge fail, human pass: the judge rejected a good answer */
  falseFail: number;
}

export type LabelPair = readonly [judgePass: boolean, humanPass: boolean];

export function confusionOf(pairs: readonly LabelPair[]): Confusion {
  const c: Confusion = { agreePass: 0, agreeFail: 0, falsePass: 0, falseFail: 0 };
  for (const [judge, human] of pairs) {
    if (judge && human) c.agreePass++;
    else if (!judge && !human) c.agreeFail++;
    else if (judge) c.falsePass++;
    else c.falseFail++;
  }
  return c;
}

/**
 * Cohen's kappa: agreement beyond what the two raters' pass rates would produce by chance.
 * 1 = perfect, 0 = chance level, negative = worse than chance. `null` when undefined (both raters
 * gave every item the same label, so chance agreement is already 1).
 */
export function cohensKappa(c: Confusion): number | null {
  const n = c.agreePass + c.agreeFail + c.falsePass + c.falseFail;
  if (n === 0) return null;
  const observed = (c.agreePass + c.agreeFail) / n;
  const judgePass = (c.agreePass + c.falsePass) / n;
  const humanPass = (c.agreePass + c.falseFail) / n;
  const chance = judgePass * humanPass + (1 - judgePass) * (1 - humanPass);
  if (chance >= 1) return null;
  return (observed - chance) / (1 - chance);
}

/** Percentile bootstrap interval for kappa, resampling labelled items. `null` with too few defined resamples. */
export function kappaInterval(
  pairs: readonly LabelPair[],
  opts: { resamples?: number; level?: number; seed?: number } = {},
): { lo: number; hi: number } | null {
  if (pairs.length < 2) return null;
  const resamples = opts.resamples ?? 4000;
  const level = opts.level ?? 0.95;
  const rand = mulberry32(opts.seed ?? 1);
  const values: number[] = [];
  const sample: LabelPair[] = new Array<LabelPair>(pairs.length);
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < pairs.length; i++) sample[i] = pairs[Math.floor(rand() * pairs.length)]!;
    const k = cohensKappa(confusionOf(sample));
    if (k !== null) values.push(k);
  }
  if (values.length < resamples / 2) return null;
  values.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.floor(q * values.length)))]!;
  return { lo: at(tail), hi: at(1 - tail) };
}
