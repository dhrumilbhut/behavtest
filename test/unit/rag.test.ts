import { afterEach, describe, expect, it } from "vitest";
import { answer, DOCS, retrieve } from "../../examples/rag/rag.mjs";
import { functionAdapter } from "../../src/core/codeSuite.js";
import { ConfigError } from "../../src/core/errors.js";
import { runSuite } from "../../src/core/runner.js";
import { parseSuite } from "../../src/core/testSuite.js";
import { retrievedDocs } from "../../src/core/trace.js";
import type { TestCase, TraceStep } from "../../src/core/types.js";
import { retrieval } from "../../src/scorers/retrieval.js";
import { SqliteStore } from "../../src/store/sqliteStore.js";
import { registry, scoreArgs } from "../helpers.js";

let store: SqliteStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

const step = (output: unknown, kind: TraceStep["kind"] = "retrieval"): TraceStep => ({ kind, name: "search", output });

describe("retrievedDocs", () => {
  it("reads {id, text, score}, plain strings, and LangChain-style documents", () => {
    const docs = retrievedDocs([
      step([
        { id: "a", text: "alpha", score: 0.9 },
        "plain text",
        { pageContent: "from langchain", metadata: { source: "handbook.pdf" } },
        { id: 7, content: "numeric id" },
      ]),
    ]);
    expect(docs).toEqual([
      { id: "a", text: "alpha", score: 0.9 },
      { text: "plain text" },
      { id: "handbook.pdf", text: "from langchain" },
      { id: "7", text: "numeric id" },
    ]);
  });

  it("reads every retrieval step in order, nested ones too, keeping each id once; ignores other steps", () => {
    const trace: TraceStep[] = [
      { kind: "agent", name: "agent", children: [step([{ id: "a" }, { id: "b" }]), step([{ id: "b" }, { id: "c" }])] },
      step([{ id: "x" }], "tool"),
    ];
    expect(retrievedDocs(trace)?.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("is undefined without a retrieval step, and empty when the step found nothing", () => {
    expect(retrievedDocs([step("x", "llm")])).toBeUndefined();
    expect(retrievedDocs(undefined)).toBeUndefined();
    expect(retrievedDocs([step([])])).toEqual([]);
  });
});

describe("retrieval scorer", () => {
  const trace = [step(["r1", "e1", "r2", "e2", "r3"].map((id) => ({ id })))];
  const score = (config: Record<string, unknown>, expectedDocs: string[] | null = ["e1", "e2"], t: TraceStep[] = trace) =>
    retrieval.score(scoreArgs({ config, expectedDocs: expectedDocs ?? undefined, trace: t }));

  it("hit: an expected document is within the top k", async () => {
    expect(await score({})).toMatchObject({ pass: true, value: 1 });
    expect(await score({ k: 1 })).toMatchObject({ pass: false, value: 0 });
    expect(await score({ k: 2 })).toMatchObject({ pass: true, value: 1 });
  });

  it("recall, precision and mrr at k", async () => {
    expect(await score({ metric: "recall", k: 2 })).toMatchObject({ pass: false, value: 0.5 });
    expect(await score({ metric: "recall", k: 4 })).toMatchObject({ pass: true, value: 1 });
    expect(await score({ metric: "recall", k: 2, min: 0.5 })).toMatchObject({ pass: true, value: 0.5 });
    expect(await score({ metric: "precision", k: 4, min: 0.5 })).toMatchObject({ pass: true, value: 0.5 });
    expect(await score({ metric: "precision", min: 0.5 })).toMatchObject({ pass: false, value: 0.4 });
    expect(await score({ metric: "mrr" })).toMatchObject({ pass: false, value: 0.5 });
    expect(await score({ metric: "mrr", min: 0.5 })).toMatchObject({ pass: true, value: 0.5 });
    expect(await score({ metric: "mrr" }, ["zzz"])).toMatchObject({ pass: false, value: 0 });
  });

  it("explains what was retrieved, at which rank, and what is missing", async () => {
    const r = await score({ metric: "recall", k: 3 });
    expect(r.reasoning).toBe("recall@3 = 0.50 (min 1); retrieved r1#1, ✓e1#2, r2#3; missing e2");
  });

  it("errors, never passes, when it cannot compare", async () => {
    expect((await score({}, null)).error).toContain('no "expectedDocs"');
    expect((await score({}, ["e1"], [step("text", "llm")])).error).toContain("no retrieval step");
    expect((await score({}, ["e1"], [step(["just text"])])).error).toContain("have no ids");
    expect((await score({ metric: "precision" })).error).toContain('"precision" needs "min"');
    expect((await score({ metric: "ndcg" })).error).toContain("invalid retrieval config");
    for (const r of [await score({}, null), await score({ metric: "ndcg" })]) expect(r.pass).toBe(false);
  });

  it("preflight rejects bad config and cases without expectedDocs", () => {
    const c = (over: Partial<TestCase>): TestCase => ({ id: "c", input: "q", scorers: ["retrieval"], expectedDocs: ["a"], ...over });
    expect(() => retrieval.preflight!({ cases: [c({})], env: {} })).not.toThrow();
    expect(() => retrieval.preflight!({ cases: [c({ expectedDocs: undefined })], env: {} })).toThrow(/case "c".*no "expectedDocs"/);
    expect(() => retrieval.preflight!({ cases: [c({ scorerConfig: { retrieval: { k: 0 } } })], env: {} })).toThrow(ConfigError);
  });

  it("the suite schema accepts expectedDocs as a non-empty list of ids", () => {
    const suite = (expectedDocs: unknown) => ({ name: "s", pipeline: { adapter: "http", config: {} }, cases: [{ id: "c", input: "q", scorers: ["retrieval"], expectedDocs }] });
    expect(parseSuite(suite(["returns"])).cases[0]?.expectedDocs).toEqual(["returns"]);
    expect(() => parseSuite(suite([]))).toThrow(ConfigError);
    expect(() => parseSuite(suite([""]))).toThrow(ConfigError);
  });
});

// question -> the policy document that answers it
const QUESTIONS: Array<[string, string]> = [
  ["Can I return a jacket after 40 days?", "returns"],
  ["How long does a refund take?", "refunds"],
  ["Do you ship to Canada?", "international"],
  ["Can I cancel my order?", "cancellations"],
  ["My parcel arrived damaged, what do I do?", "damaged"],
  ["Is express shipping available?", "shipping-express"],
  ["Do gift cards expire?", "gift-cards"],
  ["How many points do I earn per dollar?", "loyalty"],
  ["Can I return a clearance item?", "final-sale"],
  ["When is customer support open?", "support-hours"],
  ["How long is the warranty on jackets?", "warranty"],
  ["Is shipping free?", "shipping-standard"],
  ["Can I exchange for a different size?", "exchanges"],
  ["The price dropped after I bought it", "price-match"],
  ["How do I track my order?", "tracking"],
];

describe("example RAG pipeline (examples/rag)", () => {
  it.each(QUESTIONS)("healthy: %s -> retrieves %s first and answers from it", (q, id) => {
    expect(retrieve(q, 3)[0]?.id).toBe(id);
    const { output, steps } = answer(q);
    const doc = DOCS.find((d) => d.id === id)!;
    for (const sentence of output.match(/[^.]+\./g)!) expect(doc.text).toContain(sentence.trim());
    expect(steps[0]).toMatchObject({ kind: "retrieval", output: expect.arrayContaining([expect.objectContaining({ id })]) });
  });

  it("degraded: the right document goes missing; hallucinate: the answer gains an unsupported claim", () => {
    for (const [q, id] of QUESTIONS) {
      const degraded = answer(q, { mode: "degraded" });
      expect((degraded.steps[0]!.output as Array<{ id: string }>).map((d) => d.id)).not.toContain(id);
    }
    const h = answer("How long does a refund take?", { mode: "hallucinate" });
    expect(h.output).toContain("free 20 dollar gift card");
    expect(DOCS.some((d) => d.text.includes("free 20 dollar gift card"))).toBe(false);
  });
});

describe("retrieval scoring through the runner", () => {
  const suite = (mode: "healthy" | "degraded", expectedDocs?: string[]) => ({
    name: "rag",
    pipeline: { adapter: "rag-fn", config: {} },
    cases: [
      {
        id: "refund-time",
        input: "How long does a refund take?",
        scorers: expectedDocs ? ["retrieval"] : ["exactMatch"],
        expected: "x",
        ...(expectedDocs ? { expectedDocs, scorerConfig: { retrieval: { metric: "recall", k: 3 } } } : {}),
      },
    ],
    _mode: mode,
  });
  const run = async (mode: "healthy" | "degraded", expectedDocs?: string[]) => {
    const reg = registry();
    reg.registerAdapter(functionAdapter({ name: "rag-fn", run: (input) => answer(String(input), { mode }) }));
    const { _mode: _ignored, ...s } = suite(mode, expectedDocs);
    return runSuite({ suite: s, registry: reg, store: store!, regradeVersion: "t", env: {} });
  };

  it("passes when the pipeline retrieves the expected document, fails when it goes missing", async () => {
    store = new SqliteStore(":memory:");
    const good = await run("healthy", ["refunds"]);
    expect(good.exitCode).toBe(0);
    expect(good.attempts[0]?.scores[0]).toMatchObject({ scorerName: "retrieval", pass: true, value: 1 });
    const bad = await run("degraded", ["refunds"]);
    expect(bad.exitCode).toBe(1);
    expect(bad.attempts[0]?.scores[0]?.reasoning).toContain("missing refunds");
  });

  it("expectedDocs is part of the case's identity only when present", async () => {
    store = new SqliteStore(":memory:");
    const a = await run("healthy", ["refunds"]);
    const b = await run("healthy", ["refunds", "returns"]);
    const c = await run("healthy", ["refunds"]);
    expect(a.attempts[0]?.caseHash).not.toBe(b.attempts[0]?.caseHash);
    expect(a.attempts[0]?.caseHash).toBe(c.attempts[0]?.caseHash);
  });
});
