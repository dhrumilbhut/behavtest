import { afterEach, describe, expect, it } from "vitest";
import { createRegistry } from "../../src/builtins.js";
import { pickComparison } from "../../src/cli/commands/common.js";
import { ConfigError } from "../../src/core/errors.js";
import { plannedAttempts } from "../../src/core/runner.js";
import { checkSuite, parseSuite } from "../../src/core/testSuite.js";
import type { TestSuite } from "../../src/core/types.js";
import { mergeConfig, resolveVariant, runMatrix, selectVariants } from "../../src/core/variants.js";
import { renderMatrixHtml } from "../../src/matrix/html.js";
import { buildMatrix, loadMatrix, pickMatrix } from "../../src/matrix/matrix.js";
import { renderMatrixConsole, renderMatrixMarkdown, vsReferenceText } from "../../src/matrix/render.js";
import { SqliteStore } from "../../src/store/sqliteStore.js";

let store: SqliteStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});


function registry() {
  const reg = createRegistry();
  reg.registerAdapter({
    name: "quality",
    async run(input, config, ctx) {
      const mode = String(config.mode);
      const ok = mode === "good" || (mode === "half" && ctx.attempt % 2 === 0);
      return { output: ok ? String(input).toUpperCase() : "no idea", latencyMs: Number(config.ms ?? 1), costUsd: mode === "good" ? 0.002 : 0.001 };
    },
  });
  return reg;
}

const suite = (over: Partial<TestSuite> = {}): TestSuite => ({
  name: "m",
  pipeline: { adapter: "quality", config: { mode: "bad", nested: { a: 1, b: 2 }, list: [1, 2] } },
  cases: ["alpha", "beta", "gamma", "delta"].map((id) => ({ id, input: id, expected: id.toUpperCase(), scorers: ["exactMatch"] })),
  variants: [
    { name: "bad" },
    { name: "half", pipeline: { config: { mode: "half" } } },
    { name: "good", pipeline: { config: { mode: "good", nested: { b: 3 } } } },
  ],
  ...over,
});

describe("variants", () => {
  it("merges nested objects and replaces everything else", () => {
    expect(mergeConfig({ a: 1, n: { x: 1, y: 2 }, l: [1, 2], s: "k" }, { n: { y: 3 }, l: [9], s: { now: "object" } })).toEqual({
      a: 1,
      n: { x: 1, y: 3 },
      l: [9],
      s: { now: "object" },
    });
  });

  it("resolves a variant: config merged over the suite's, or replaced by a different adapter; variants removed", () => {
    const s = suite();
    const good = resolveVariant(s, s.variants![2]!);
    expect(good.pipeline).toEqual({ adapter: "quality", config: { mode: "good", nested: { a: 1, b: 3 }, list: [1, 2] } });
    expect(good.variants).toBeUndefined();
    expect(good.cases).toBe(s.cases);
    const other = resolveVariant(s, { name: "x", pipeline: { adapter: "http", config: { url: "http://x" } } });
    expect(other.pipeline).toEqual({ adapter: "http", config: { url: "http://x" } });
    expect(resolveVariant(s, { name: "same" }).pipeline).toEqual(s.pipeline);
  });

  it("selects variants by name, in the suite's order, and names unknown ones", () => {
    const s = suite();
    expect(selectVariants(s).map((v) => v.name)).toEqual(["bad", "half", "good"]);
    expect(selectVariants(s, ["good", "bad"]).map((v) => v.name)).toEqual(["bad", "good"]);
    expect(() => selectVariants(s, ["good", "nope"])).toThrow(/unknown variant nope \(suite has: bad, half, good\)/);
    expect(() => selectVariants(suite({ variants: undefined }), ["x"])).toThrow(/has no variants/);
  });

  it("validates variants: at least two, unique names, known adapters, no unknown keys", () => {
    expect(() => parseSuite({ ...suite(), variants: [{ name: "one" }] })).toThrow(/at least two variants/);
    expect(() => parseSuite({ ...suite(), variants: [{ name: "a b" }, { name: "c" }] })).toThrow(/name may only contain/);
    expect(() => parseSuite({ ...suite(), variants: [{ name: "a", judge: "x" }, { name: "b" }] })).toThrow(/judge/);
    const dup = parseSuite({ ...suite(), variants: [{ name: "a" }, { name: "a", pipeline: { adapter: "nope" } }] });
    expect(() => checkSuite(dup, registry())).toThrow(/duplicate variant "a"[\s\S]*unknown adapter "nope"/);
  });

  it("counts planned attempts with the case filters and repeats", () => {
    expect(plannedAttempts(suite(), { repeat: 3 })).toEqual({ cases: 4, attempts: 12 });
    expect(plannedAttempts(suite(), { caseIds: ["alpha"] })).toEqual({ cases: 1, attempts: 1 });
    expect(() => plannedAttempts(suite(), { caseIds: ["zzz"] })).toThrow(ConfigError);
  });
});

async function matrixRun(over: Partial<TestSuite> = {}, extra: { variants?: string[]; signal?: AbortSignal } = {}) {
  store = new SqliteStore(":memory:");
  return runMatrix({ suite: suite(over), registry: registry(), store, regradeVersion: "t", overrides: { repeat: 2 }, ...extra });
}

describe("runMatrix", () => {
  it("makes one ordinary run per variant, grouped by a matrix id", async () => {
    const m = await matrixRun();
    expect(m.runs.map((r) => [r.variant, r.summary.attempts.passed])).toEqual([
      ["bad", 0],
      ["half", 4],
      ["good", 8],
    ]);
    expect(m.exitCode).toBe(1);
    const runs = store!.listRuns({ limit: 10 });
    expect(runs).toHaveLength(3);
    expect(new Set(runs.map((r) => r.matrixId))).toEqual(new Set([m.matrixId]));
    expect(runs.map((r) => (r.pipeline as { config: { mode: string } }).config.mode).sort()).toEqual(["bad", "good", "half"]);
    // case hashes do not depend on the pipeline, so variants compare case by case
    const hashes = m.runs.map((r) => r.attempts.find((a) => a.caseId === "alpha" && a.attempt === 1)!.caseHash);
    expect(new Set(hashes).size).toBe(1);
    const summary = store!.getMatrix!(m.matrixId.slice(0, 8))!;
    expect(summary.variants.map((v) => v.variant)).toEqual(["bad", "half", "good"]);
    expect(store!.listMatrices!()).toHaveLength(1);
  });

  it("runs only the chosen variants, and exits 0 when they all pass", async () => {
    const m = await matrixRun({}, { variants: ["good"] });
    expect(m.runs.map((r) => r.variant)).toEqual(["good"]);
    expect(m.exitCode).toBe(0);
  });

  it("stops after an interrupted variant and reports 130", async () => {
    const ac = new AbortController();
    ac.abort();
    const m = await matrixRun({}, { signal: ac.signal });
    expect(m.exitCode).toBe(130);
    expect(m.runs.length).toBeLessThan(3);
  });

  it("plain runs keep their shape; matrix runs carry matrixId and variant", async () => {
    await matrixRun();
    const plain = { runId: "plain-1", suiteName: "m", suiteHash: "h", startedAt: "2026-01-01T00:00:00.000Z", regradeVersion: "t", gitSha: null, gitDirty: null, label: null, pipeline: {} };
    store!.createRun(plain);
    expect(Object.keys(store!.getRun("plain-1")!)).not.toContain("variant");
    expect(store!.listRuns({ limit: 10 }).filter((r) => r.variant).length).toBe(3);
  });
});

describe("buildMatrix", () => {
  it("compares each variant with the reference using compare's statistics, and builds the case grid", async () => {
    const m = await matrixRun();
    const report = buildMatrix(m.matrixId, loadMatrix(store!, store!.getMatrix!(m.matrixId)!));
    expect(report.reference).toBe("bad");
    expect(report.variants.map((v) => [v.variant, v.attemptRate?.rate])).toEqual([
      ["bad", 0],
      ["half", 0.5],
      ["good", 1],
    ]);
    expect(report.variants[0]!.vsReference).toBeNull();
    expect(report.variants[2]!.vsReference).toMatchObject({ comparableCases: 4, meanDelta: 1, regressed: 0, improved: 4 });
    expect(report.variants[1]!.vsReference!.meanDelta).toBeCloseTo(0.5);
    expect(report.cases.map((k) => k.caseId)).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(report.cases[0]!.cells).toEqual([
      { passed: 0, attempts: 2, verdict: "failed" },
      { passed: 1, attempts: 2, verdict: "flaky" },
      { passed: 2, attempts: 2, verdict: "passed" },
    ]);

    const vsGood = buildMatrix(m.matrixId, loadMatrix(store!, store!.getMatrix!(m.matrixId)!), "good");
    expect(vsGood.variants[0]!.vsReference!.meanDelta).toBe(-1);
    expect(vsGood.variants[0]!.vsReference!.regressed).toBe(4);
    expect(() => buildMatrix(m.matrixId, loadMatrix(store!, store!.getMatrix!(m.matrixId)!), "nope")).toThrow(/no variant "nope"/);
  });

  it("warns when variants were judged by different judges or did not complete", async () => {
    const m = await matrixRun();
    const runs = loadMatrix(store!, store!.getMatrix!(m.matrixId)!);
    runs[1] = { ...runs[1]!, run: { ...runs[1]!.run, status: "interrupted", pipeline: { ...runs[1]!.run.pipeline, judge: "openai:x" } } };
    const report = buildMatrix(m.matrixId, runs);
    expect(report.warnings.join(" ")).toMatch(/"half" is interrupted/);
    expect(report.warnings.join(" ")).toMatch(/different judge models/);
  });

  it("renders console, Markdown and a self-contained HTML file", async () => {
    const m = await matrixRun();
    const report = buildMatrix(m.matrixId, loadMatrix(store!, store!.getMatrix!(m.matrixId)!));
    const text = renderMatrixConsole(report, { color: false });
    expect(text).toContain("regrade matrix · m · 3 variants");
    expect(text).toMatch(/bad \*\s+quality/);
    expect(text).toContain("+100.0 pts");
    expect(text).toMatch(/alpha\s+0\/2 ✗\s+1\/2 ~\s+2\/2 ✓/);
    expect(renderMatrixConsole(report, { color: false, ascii: true })).toMatch(/alpha\s+0\/2 FAIL\s+1\/2 ~\s+2\/2 ok/);
    const md = renderMatrixMarkdown(report);
    expect(md).toContain("| bad (reference) | `quality` |");
    expect(md).toContain("| `alpha` | 0/2 failed | 1/2 flaky | 2/2 passed |");
    expect(vsReferenceText(report.variants[0]!)).toBe("reference");
    const html = renderMatrixHtml({ ...report, suiteName: "</script><b>x" }, "9.9.9");
    expect(html).not.toContain("</script><b>x");
    expect(html).toContain("default-src 'none'");
    const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((x) => x[1] as string).filter((x) => !x.startsWith("{"));
    for (const s of scripts) expect(() => new Function(s)).not.toThrow();
  });
});

describe("picking runs and matrices", () => {
  it("regrade compare with one run compares it with the previous run of the same variant", async () => {
    await matrixRun();
    const second = await runMatrix({ suite: suite(), registry: registry(), store: store!, regradeVersion: "t", overrides: { repeat: 1 }, variants: ["half"] });
    const head = store!.getRun(second.runs[0]!.run.runId)!;
    const { base } = pickComparison(store!, [head.runId]);
    expect(base.variant).toBe("half");
  });

  it("the default matrix is the latest with two or more variants", async () => {
    const full = await matrixRun();
    await runMatrix({ suite: suite(), registry: registry(), store: store!, regradeVersion: "t", overrides: { repeat: 1 }, variants: ["good"] });
    expect(pickMatrix(store!, undefined).matrixId).toBe(full.matrixId);
    expect(() => pickMatrix(store!, "zzzz")).toThrow(/No matrix matching/);
    expect(() => pickMatrix(store!, undefined, "other-suite")).toThrow(/No matrix runs of suite "other-suite"/);
  });
});
