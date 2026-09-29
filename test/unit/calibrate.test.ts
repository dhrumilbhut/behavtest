import { afterEach, describe, expect, it } from "vitest";
import { calibrate, calibrationGate, parseLabels, type Label } from "../../src/calibration/calibrate.js";
import { renderCalibration, renderCalibrationMarkdown } from "../../src/cli/commands/calibrate.js";
import { ConfigError } from "../../src/core/errors.js";
import type { RunRecord } from "../../src/core/types.js";
import { cohensKappa, confusionOf, kappaInterval, type LabelPair } from "../../src/stats/agreement.js";
import { SqliteStore } from "../../src/store/sqliteStore.js";
import { attempt } from "../helpers.js";

let store: SqliteStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

const pairs = (agreePass: number, falsePass: number, falseFail: number, agreeFail: number): LabelPair[] => [
  ...Array.from({ length: agreePass }, () => [true, true] as const),
  ...Array.from({ length: falsePass }, () => [true, false] as const),
  ...Array.from({ length: falseFail }, () => [false, true] as const),
  ...Array.from({ length: agreeFail }, () => [false, false] as const),
];

describe("Cohen's kappa", () => {
  it("matches the textbook example: 20/5/10/15 gives observed 0.70, chance 0.50, kappa 0.40", () => {
    // Two raters, 50 items: both yes 20, A yes B no 5, A no B yes 10, both no 15.
    const c = confusionOf(pairs(20, 5, 10, 15));
    expect(cohensKappa(c)).toBeCloseTo(0.4, 10);
  });

  it("is 1 for perfect agreement, 0 at chance, negative below chance, null when undefined", () => {
    expect(cohensKappa(confusionOf(pairs(10, 0, 0, 10)))).toBe(1);
    expect(cohensKappa(confusionOf(pairs(5, 5, 5, 5)))).toBeCloseTo(0, 10);
    expect(cohensKappa(confusionOf(pairs(0, 10, 10, 0)))).toBe(-1);
    expect(cohensKappa(confusionOf(pairs(10, 0, 0, 0)))).toBeNull(); // everyone said pass
    expect(cohensKappa(confusionOf([]))).toBeNull();
  });

  it("the bootstrap interval brackets the estimate, is reproducible, and narrows with more labels", () => {
    const small = pairs(8, 2, 2, 8);
    const big = pairs(80, 20, 20, 80);
    const a = kappaInterval(small)!;
    expect(a).toEqual(kappaInterval(small));
    expect(a.lo).toBeLessThanOrEqual(0.6);
    expect(a.hi).toBeGreaterThanOrEqual(0.6);
    const b = kappaInterval(big)!;
    expect(b.hi - b.lo).toBeLessThan(a.hi - a.lo);
    expect(kappaInterval([[true, true]])).toBeNull();
  });
});

describe("labels file", () => {
  it("defaults attempt to 1 and scorer to llmJudge; ignores blank lines", () => {
    const labels = parseLabels('{"run":"r1","case":"a","label":"pass"}\n\n{"run":"r1","case":"b","attempt":2,"scorer":"faithfulness","label":"fail","note":"invents a gift card"}\n', "l.jsonl");
    expect(labels).toEqual([
      { run: "r1", case: "a", attempt: 1, scorer: "llmJudge", label: "pass" },
      { run: "r1", case: "b", attempt: 2, scorer: "faithfulness", label: "fail", note: "invents a gift card" },
    ]);
  });

  it("names every bad line", () => {
    const bad = 'nope\n{"run":"r","case":"a","label":"maybe"}\n{"run":"r","label":"pass"}';
    expect(() => parseLabels(bad, "l.jsonl")).toThrow(ConfigError);
    expect(() => parseLabels(bad, "l.jsonl")).toThrow(/line 1: not valid JSON[\s\S]*line 2: label[\s\S]*line 3: case/);
    expect(() => parseLabels("\n", "l.jsonl")).toThrow(/has no labels/);
  });
});

function seed(): SqliteStore {
  const s = new SqliteStore(":memory:");
  const run = (runId: string): RunRecord => ({
    runId, suiteName: "s", suiteHash: "h", startedAt: "2026-09-28T10:00:00.000Z", finishedAt: null, status: "running",
    behavtestVersion: "t", gitSha: null, gitDirty: null, label: null, pipeline: {}, summary: null,
  });
  s.createRun(run("run-one"));
  // 40 judged attempts: the judge passes the even ones; one attempt's judge call errored
  for (let i = 1; i <= 40; i++) {
    s.saveAttempt("run-one", attempt({
      caseId: "c", attempt: i,
      scores: [{ scorerName: "llmJudge", pass: i % 2 === 0, value: i % 2 === 0 ? 1 : 0, config: { rubric: "Cites the policy?" }, metadata: { judge: "openai:gpt-4.1-nano", temperature: 0 } }],
    }));
  }
  s.saveAttempt("run-one", attempt({ caseId: "broken", attempt: 1, status: "errored", scores: [{ scorerName: "llmJudge", pass: false, value: null, error: "judge call failed", metadata: { judge: "openai:gpt-4.1-nano" } }] }));
  s.saveAttempt("run-one", attempt({ caseId: "tone", attempt: 1, scores: [{ scorerName: "llmJudge", pass: true, value: 1, config: { rubric: "Polite?" }, metadata: { judge: "openai:gpt-4.1-nano" } }] }));
  s.saveAttempt("run-one", attempt({ caseId: "tone", attempt: 2, scores: [{ scorerName: "llmJudge", pass: true, value: 1, config: { rubric: "Polite?" }, metadata: { judge: "openai:gpt-6-luna" } }] }));
  s.saveAttempt("run-one", attempt({ caseId: "rag", attempt: 1, scores: [{ scorerName: "faithfulness", pass: true, value: 1, config: { mode: "claims" }, metadata: { judge: "openai:gpt-6-luna" } }] }));
  return s;
}

/** The human agrees with the judge except on attempts 1-4 (judge failed 1 and 3, passed 2 and 4). */
const humanLabels = (): Label[] =>
  Array.from({ length: 40 }, (_, j) => {
    const i = j + 1;
    const judgePass = i % 2 === 0;
    return { run: "run-o", case: "c", attempt: i, scorer: "llmJudge", label: (i <= 4 ? !judgePass : judgePass) ? "pass" : "fail" };
  });

describe("calibrate", () => {
  it("matches labels to stored verdicts and measures agreement, kappa and the error rates", () => {
    store = seed();
    const report = calibrate(store, humanLabels());
    expect(report).toMatchObject({ labels: 40, used: 40, unmatched: [], onErrored: 0, duplicates: 0 });
    expect(report.groups).toHaveLength(1);
    const g = report.groups[0]!;
    expect(g).toMatchObject({ scorer: "llmJudge", judge: "openai:gpt-4.1-nano", rubric: "Cites the policy?", n: 40, enoughLabels: true });
    expect(g.confusion).toEqual({ agreePass: 18, agreeFail: 18, falsePass: 2, falseFail: 2 });
    expect(g.agreement.rate).toBe(0.9);
    expect(g.kappa).toBeCloseTo(0.8, 10);
    expect(g.falsePassRate).toBeCloseTo(0.1, 10);
    expect(g.falseFailRate).toBeCloseTo(0.1, 10);
    expect(g.kappaInterval!.lo).toBeLessThan(0.8);
    expect(g.kappaInterval!.hi).toBeGreaterThan(0.8);
  });

  it("reports labels it cannot use: unknown run, case, attempt or scorer; errored verdicts; duplicates (last wins)", () => {
    store = seed();
    const labels: Label[] = [
      { run: "nope", case: "c", attempt: 1, scorer: "llmJudge", label: "pass" },
      { run: "run-one", case: "zzz", attempt: 1, scorer: "llmJudge", label: "pass" },
      { run: "run-one", case: "c", attempt: 99, scorer: "llmJudge", label: "pass" },
      { run: "run-one", case: "c", attempt: 1, scorer: "exactMatch", label: "pass" },
      { run: "run-one", case: "broken", attempt: 1, scorer: "llmJudge", label: "fail" },
      { run: "run-one", case: "c", attempt: 2, scorer: "llmJudge", label: "fail" },
      { run: "run-one", case: "c", attempt: 2, scorer: "llmJudge", label: "pass" },
    ];
    const report = calibrate(store, labels);
    expect(report.unmatched.map((u) => u.reason)).toEqual([
      'no run matching "nope"',
      'run run-one has no attempt 1 of case "zzz"',
      'run run-one has no attempt 99 of case "c"',
      'case "c" was not scored by exactMatch',
    ]);
    expect(report).toMatchObject({ onErrored: 1, duplicates: 1, used: 1 });
    expect(report.groups[0]!.confusion).toEqual({ agreePass: 1, agreeFail: 0, falsePass: 0, falseFail: 0 });
    expect(report.groups[0]!.enoughLabels).toBe(false);
  });

  it("groups by scorer, judge and rubric (a judge is calibrated for one rubric, not in general)", () => {
    store = seed();
    const report = calibrate(store, [
      ...humanLabels(),
      { run: "run-one", case: "rag", attempt: 1, scorer: "faithfulness", label: "pass" },
      { run: "run-one", case: "tone", attempt: 1, scorer: "llmJudge", label: "pass" },
      { run: "run-one", case: "tone", attempt: 2, scorer: "llmJudge", label: "pass" },
    ]);
    expect(report.groups.map((g) => [g.scorer, g.judge, g.rubric, g.n])).toEqual([
      ["llmJudge", "openai:gpt-4.1-nano", "Cites the policy?", 40],
      ["faithfulness", "openai:gpt-6-luna", "mode: claims", 1],
      ["llmJudge", "openai:gpt-4.1-nano", "Polite?", 1],
      ["llmJudge", "openai:gpt-6-luna", "Polite?", 1],
    ]);
  });

  it("the gate needs enough labels and kappa at or above the threshold for every group", () => {
    store = seed();
    const report = calibrate(store, humanLabels());
    expect(calibrationGate(report, 0.6)).toEqual({ failed: false, reasons: [] });
    expect(calibrationGate(report, 0.85).reasons[0]).toContain("kappa 0.80 is below 0.85");
    const few = calibrate(store, humanLabels().slice(0, 10));
    expect(calibrationGate(few, 0.1).reasons[0]).toContain("10 labels, fewer than the 30 needed");
    const none = calibrate(store, [{ run: "nope", case: "c", attempt: 1, scorer: "llmJudge", label: "pass" }]);
    expect(calibrationGate(none, 0.1)).toEqual({ failed: true, reasons: ["no labels matched a stored verdict"] });
  });

  it("renders the numbers, the confusion matrix and the gate for people and for Markdown", () => {
    store = seed();
    const report = calibrate(store, humanLabels());
    const text = renderCalibration(report, calibrationGate(report, 0.6), false);
    expect(text).toContain("behavtest calibrate · 40 labels, 40 matched");
    expect(text).toContain('llmJudge · judge openai:gpt-4.1-nano · "Cites the policy?"');
    expect(text).toMatch(/labels 40 {3}agreement 90% \[\d+%–\d+%\] {3}kappa 0\.80 \[0\.\d\d, 0\.\d\d\] {2}\(almost perfect agreement\)/);
    expect(text).toContain("judge passed 2 of 20 answers you failed (false pass 10%) · failed 2 of 20 you passed (false fail 10%)");
    expect(text).toContain("Gate passed");
    const md = renderCalibrationMarkdown(report, undefined);
    expect(md).toContain("| llmJudge | openai:gpt-4.1-nano | \"Cites the policy?\" | 40 | 90%");
  });
});

describe("calibrate from stored labels", () => {
  it("behavtest calibrate without --labels reads the labels saved in the database", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { calibrateCommand } = await import("../../src/cli/commands/calibrate.js");
    const dir = mkdtempSync(join(tmpdir(), "behavtest-cal-"));
    const path = join(dir, "results.db");
    const s = new SqliteStore(path);
    s.createRun({ runId: "run-one", suiteName: "s", suiteHash: "h", startedAt: "2026-09-28T10:00:00.000Z", behavtestVersion: "t", gitSha: null, gitDirty: null, label: null, pipeline: {} });
    s.saveAttempt("run-one", attempt({ caseId: "c", attempt: 1, scores: [{ scorerName: "llmJudge", pass: true, value: 1, metadata: { judge: "openai:x" } }] }));
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => (writes.push(String(chunk)), true)) as typeof process.stdout.write;
    try {
      expect(() => calibrateCommand({ db: path, color: false })).toThrow(/No labels stored in the database yet/);
      s.setLabel({ runId: "run-one", caseId: "c", attempt: 1, scorer: "llmJudge", label: "pass", updatedAt: "t" });
      expect(calibrateCommand({ db: path, color: false })).toBe(0);
    } finally {
      process.stdout.write = orig;
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(writes.join("")).toContain("behavtest calibrate · 1 labels, 1 matched");
  });
});
