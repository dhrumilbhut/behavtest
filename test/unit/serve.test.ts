import { request } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AttemptRecord, RunRecord } from "../../src/core/types.js";
import { summarize } from "../../src/core/verdict.js";
import { DASHBOARD_JS, renderDashboard } from "../../src/serve/page.js";
import { hostAllowed, hostnameOf, isLoopback, MAX_BODY_BYTES, originAllowed, startDashboard, type DashboardServer } from "../../src/serve/server.js";
import { SqliteStore } from "../../src/store/sqliteStore.js";
import type { Store } from "../../src/store/store.js";
import { attempt } from "../helpers.js";

const judged = (pass: boolean) => ({ scorerName: "llmJudge", pass, value: pass ? 1 : 0, reasoning: pass ? "ok" : "wrong", metadata: { judge: "openai:gpt-5.4-nano" } });
const exact = (pass: boolean) => ({ scorerName: "exactMatch", pass, value: pass ? 1 : 0 });

function addRun(s: SqliteStore, runId: string, startedAt: string, attempts: AttemptRecord[], finish = true, suiteName = "support"): void {
  const run: Omit<RunRecord, "finishedAt" | "summary" | "status"> = {
    runId, suiteName, suiteHash: "h", startedAt, regradeVersion: "t", gitSha: "abcdef1234", gitDirty: false, label: `label-${runId}`, pipeline: { secretish: "not listed" },
  };
  s.createRun(run);
  for (const a of attempts) s.saveAttempt(runId, a);
  if (finish) s.finishRun(runId, "completed", startedAt, summarize(attempts));
}

function seed(): SqliteStore {
  const s = new SqliteStore(":memory:");
  const trace = [{ kind: "tool" as const, name: "lookup_order", startOffsetMs: 0, durationMs: 5, input: { id: 1 }, output: "shipped" }];
  addRun(s, "aaaa1111-base", "2026-09-28T10:00:00.000Z", [
    attempt({ caseId: "order", attempt: 1, output: "shipped", scores: [judged(true), exact(true)], trace }),
    attempt({ caseId: "refund", attempt: 1, output: "30 days", scores: [judged(true)] }),
  ]);
  addRun(s, "bbbb2222-head", "2026-09-28T11:00:00.000Z", [
    attempt({ caseId: "order", attempt: 1, output: "no idea", status: "failed", scores: [judged(false), exact(false)], trace }),
    attempt({ caseId: "refund", attempt: 1, output: "30 days", scores: [judged(true)] }),
    attempt({ caseId: "</script><img src=x onerror=alert(1)>", attempt: 1, output: "<b>hi</b>", scores: [judged(true)] }),
    attempt({ caseId: "broken", attempt: 1, status: "errored", output: null, error: "timeout", scores: [{ ...judged(false), error: "judge call failed" }] }),
  ]);
  addRun(s, "cccc3333-live", "2026-09-28T12:00:00.000Z", [attempt({ caseId: "order", attempt: 1 })], false);
  addRun(s, "dddd4444-other", "2026-09-28T09:00:00.000Z", [attempt({ caseId: "x", attempt: 1 })], true, "triage");
  return s;
}

let store: SqliteStore;
let dash: DashboardServer;
beforeEach(async () => {
  store = seed();
  dash = await startDashboard({ store, version: "9.9.9", port: 0, db: "results.db" });
});
afterEach(async () => {
  await dash.close();
  store.close();
});

interface Res { status: number; headers: Record<string, string | string[] | undefined>; text: string; json: any }

/** A raw request, so tests control the Host and Origin headers exactly. */
function call(method: string, path: string, opts: { body?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: dash.port, method, path, headers: { Host: `127.0.0.1:${dash.port}`, ...opts.headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (text += d));
      res.on("end", () => {
        let json: unknown;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
const api = (method: string, path: string, opts: { body?: string; headers?: Record<string, string> } = {}) => call(method, `/api/v1${path}`, opts);
const putLabel = (body: unknown, headers: Record<string, string> = {}) =>
  api("PUT", "/labels", { body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${dash.port}`, ...headers } });

describe("dashboard server guards", () => {
  it("parses Host headers, including IPv6 and missing ports", () => {
    expect(hostnameOf("localhost:4800")).toBe("localhost");
    expect(hostnameOf("[::1]:4800")).toBe("::1");
    expect(hostnameOf("EXAMPLE.com")).toBe("example.com");
    expect(hostnameOf("::1")).toBe("::1");
    expect(isLoopback("127.0.0.1") && isLoopback("::1") && isLoopback("localhost") && isLoopback("127.1.2.3")).toBe(true);
    expect(isLoopback("0.0.0.0") || isLoopback("192.168.1.5")).toBe(false);
  });

  it("accepts only Host names that DNS rebinding cannot use", () => {
    for (const ok of ["localhost:4800", "127.0.0.1:4800", "[::1]:4800", "192.168.1.5:4800"]) expect(hostAllowed(ok, "127.0.0.1"), ok).toBe(true);
    for (const bad of [undefined, "", "evil.example:4800", "localhost.evil.example", "127.0.0.1.nip.io:4800"]) expect(hostAllowed(bad, "127.0.0.1"), String(bad)).toBe(false);
    expect(hostAllowed("devbox.lan:4800", "devbox.lan")).toBe(true); // the host it was started with
  });

  it("allows writes only from the dashboard's own origin (or from tools that send no Origin)", () => {
    expect(originAllowed("http://127.0.0.1:4800", "127.0.0.1:4800")).toBe(true);
    expect(originAllowed(undefined, "127.0.0.1:4800")).toBe(true);
    expect(originAllowed("http://evil.example", "127.0.0.1:4800")).toBe(false);
    expect(originAllowed("null", "127.0.0.1:4800")).toBe(false);
    expect(originAllowed("http://localhost:4800", "127.0.0.1:4800")).toBe(false);
    expect(originAllowed("https://127.0.0.1:4800", "127.0.0.1:4800")).toBe(false);
  });

  it("refuses a rebound Host (421) on the page and the API", async () => {
    for (const path of ["/", "/api/v1/runs"]) {
      const r = await call("GET", path, { headers: { Host: `attacker.example:${dash.port}` } });
      expect(r.status, path).toBe(421);
      expect(r.text).not.toContain("support");
    }
    expect((await call("GET", "/api/v1/runs", { headers: { Host: `localhost:${dash.port}` } })).status).toBe(200);
  });

  it("refuses a cross-origin write and leaves the database unchanged", async () => {
    const r = await putLabel({ run: "bbbb2222", case: "order", attempt: 1, scorer: "llmJudge", label: "fail" }, { Origin: "http://evil.example" });
    expect(r.status).toBe(403);
    const d = await api("DELETE", "/labels?run=bbbb2222&case=order&attempt=1&scorer=llmJudge", { headers: { Origin: "http://evil.example" } });
    expect(d.status).toBe(403);
    expect(store.listLabels()).toEqual([]);
  });

  it("serves the page with a strict CSP and hardening headers", async () => {
    const r = await call("GET", "/");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(r.headers["content-security-policy"]).toContain("connect-src 'self'");
    expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.text).toContain("results.db");
    const j = await api("GET", "/runs");
    expect(j.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(j.headers["x-content-type-options"]).toBe("nosniff");
    expect((await call("HEAD", "/")).text).toBe("");
    expect((await call("POST", "/")).status).toBe(405);
  });

  it("limits body size, requires JSON for PUT, and rejects bad JSON", async () => {
    const huge = await putLabel({ run: "bbbb2222", case: "x".repeat(MAX_BODY_BYTES + 10), attempt: 1, scorer: "llmJudge", label: "pass" });
    expect(huge.status).toBe(413); // streamed (chunked) body
    const bigBody = JSON.stringify({ run: "bbbb2222", case: "x".repeat(MAX_BODY_BYTES), attempt: 1, scorer: "llmJudge", label: "pass" });
    const declared = await api("PUT", "/labels", { body: bigBody, headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bigBody)) } });
    expect(declared.status).toBe(413);
    expect(declared.headers.connection).toBe("close");
    expect(store.listLabels()).toEqual([]);
    const noType = await api("PUT", "/labels", { body: "{}", headers: { "Content-Type": "text/plain" } });
    expect(noType.status).toBe(415);
    const bad = await api("PUT", "/labels", { body: "{nope", headers: { "Content-Type": "application/json" } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/not valid JSON/);
  });

  it("answers unknown routes, wrong methods and bad input with JSON errors", async () => {
    expect((await api("GET", "/nope")).status).toBe(404);
    expect((await api("GET", "/runs/a/b")).status).toBe(404);
    expect((await call("GET", "/etc/passwd")).status).toBe(404);
    expect((await call("GET", "/../../etc/passwd")).status).toBe(404);
    expect((await api("POST", "/labels")).status).toBe(405);
    expect((await api("DELETE", "/runs")).status).toBe(405);
    expect((await api("GET", "/runs/%E0%A4%A")).status).toBe(400);
    expect((await api("GET", "/runs?limit=0")).status).toBe(400);
    expect((await api("GET", "/runs?limit=abc")).status).toBe(400);
    expect((await api("GET", "/compare?base=aaaa")).status).toBe(400);
    expect((await api("GET", "/runs/zzzz")).json).toEqual({ error: { status: 404, message: 'No run matching "zzzz".' } });
    // "b" is not ambiguous, but the empty-ish prefix shared by no runs is 404; an ambiguous one is 400
    store.createRun({ runId: "bbbb9999-dup", suiteName: "support", suiteHash: "h", startedAt: "2026-09-28T13:00:00.000Z", regradeVersion: "t", gitSha: null, gitDirty: null, label: null, pipeline: {} });
    expect((await api("GET", "/runs/bbbb")).status).toBe(400);
  });
});

describe("dashboard API", () => {
  it("lists suites with run counts and their latest run", async () => {
    const r = await api("GET", "/suites");
    expect(r.json.suites.map((s: any) => [s.suiteName, s.runs, s.latest.runId])).toEqual([
      ["support", 3, "cccc3333-live"],
      ["triage", 1, "dddd4444-other"],
    ]);
  });

  it("lists runs newest first, filters by suite, and leaves out the pipeline config", async () => {
    const all = await api("GET", "/runs");
    expect(all.json.runs.map((r: any) => r.runId)).toEqual(["cccc3333-live", "bbbb2222-head", "aaaa1111-base", "dddd4444-other"]);
    expect(all.json.runs[0].pipeline).toBeUndefined();
    const head = all.json.runs[1];
    expect(head.attemptRate).toMatchObject({ passed: 2, attempts: 3 }); // the errored attempt has no verdict
    const one = await api("GET", "/runs?suite=triage&limit=1");
    expect(one.json.runs.map((r: any) => r.runId)).toEqual(["dddd4444-other"]);
  });

  it("returns a run like the report's data, without traces, plus its labels", async () => {
    const r = await api("GET", "/runs/bbbb2222");
    expect(r.status).toBe(200);
    expect(r.json.run.runId).toBe("bbbb2222-head");
    expect(r.json.cases.map((c: any) => c.caseId)).toContain("</script><img src=x onerror=alert(1)>");
    const order = r.json.cases.find((c: any) => c.caseId === "order");
    expect(order.attempts[0].trace).toBeNull();
    expect(order.attempts[0].scores.find((s: any) => s.scorerName === "llmJudge").judged).toBe(true);
    expect(order.attempts[0].scores.find((s: any) => s.scorerName === "exactMatch").judged).toBe(false);
    expect(r.json.labels).toEqual([]);
  });

  it("returns one case with its traces, and 404 for an unknown case", async () => {
    const r = await api("GET", "/runs/bbbb2222/cases/order");
    expect(r.json.case.caseId).toBe("order");
    expect(r.json.case.attempts[0].trace[0]).toMatchObject({ kind: "tool", name: "lookup_order", output: "shipped" });
    const odd = await api("GET", `/runs/bbbb2222/cases/${encodeURIComponent("</script><img src=x onerror=alert(1)>")}`);
    expect(odd.json.case.attempts[0].output).toBe("<b>hi</b>");
    expect(odd.text).not.toContain("</script>"); // served as JSON, but still: no raw closing tag
    expect((await api("GET", "/runs/bbbb2222/cases/missing")).status).toBe(404);
  });

  it("compares any two runs", async () => {
    const r = await api("GET", "/compare?base=aaaa1111&head=bbbb2222");
    expect(r.json.comparison.base.runId).toBe("aaaa1111-base");
    expect(r.json.comparison.counts.regressed).toBe(1);
    expect(r.json.comparison.cases.find((c: any) => c.caseId === "order").change).toBe("regressed");
  });

  it("gives the pass-rate trend of a suite, oldest first, skipping unfinished runs", async () => {
    const r = await api("GET", "/trend?suite=support");
    expect(r.json.points.map((p: any) => p.runId)).toEqual(["aaaa1111-base", "bbbb2222-head"]);
    expect(r.json.points[0]).toMatchObject({ label: "label-aaaa1111-base", cases: { total: 2, passed: 2 }, attemptRate: { rate: 1 } });
    expect((await api("GET", "/trend")).status).toBe(400);
  });

  it("saves, lists, calibrates and deletes labels", async () => {
    const put = await putLabel({ run: "bbbb2222", case: "order", attempt: 1, scorer: "llmJudge", label: "pass", note: "fine actually" });
    expect(put.status).toBe(200);
    expect(put.json.label).toMatchObject({ runId: "bbbb2222-head", caseId: "order", attempt: 1, scorer: "llmJudge", label: "pass", note: "fine actually" });
    // a second PUT on the same verdict replaces it
    await putLabel({ run: "bbbb2222-head", case: "refund", attempt: 1, scorer: "llmJudge", label: "pass" });
    await putLabel({ run: "bbbb2222-head", case: "refund", attempt: 1, scorer: "llmJudge", label: "fail" });
    const listed = await api("GET", "/labels?run=bbbb2222");
    expect(listed.json.labels.map((l: any) => `${l.caseId}:${l.label}`).sort()).toEqual(["order:pass", "refund:fail"]);
    expect((await api("GET", "/runs/bbbb2222")).json.labels).toHaveLength(2);

    const cal = await api("GET", "/calibration");
    expect(cal.json.calibration).toMatchObject({ labels: 2, used: 2 });
    expect(cal.json.calibration.groups[0]).toMatchObject({ scorer: "llmJudge", judge: "openai:gpt-5.4-nano", n: 2 });
    // judge failed "order" (you passed it) and passed "refund" (you failed it): both disagree
    expect(cal.json.disagreements.map((d: any) => [d.caseId, d.judgePass, d.label])).toEqual([
      ["order", false, "pass"],
      ["refund", true, "fail"],
    ]);
    expect((await api("GET", "/calibration?run=aaaa1111")).json.calibration.labels).toBe(0);

    const del = await api("DELETE", "/labels?run=bbbb2222&case=order&attempt=1&scorer=llmJudge");
    expect(del.json).toEqual({ deleted: true });
    expect((await api("DELETE", "/labels?run=bbbb2222&case=order&attempt=1&scorer=llmJudge")).json).toEqual({ deleted: false });
    expect(store.listLabels().map((l) => l.caseId)).toEqual(["refund"]);
    expect((await api("DELETE", "/labels?run=bbbb2222&case=order&scorer=llmJudge")).status).toBe(400);
  });

  it("accepts labels only on real judge verdicts", async () => {
    const cases: Array<[unknown, number, RegExp]> = [
      [{ run: "bbbb2222", case: "order", attempt: 1, scorer: "exactMatch", label: "pass" }, 400, /not a judge verdict/],
      [{ run: "bbbb2222", case: "broken", attempt: 1, scorer: "llmJudge", label: "pass" }, 400, /not a judge verdict/],
      [{ run: "bbbb2222", case: "order", attempt: 2, scorer: "llmJudge", label: "pass" }, 404, /no attempt 2/],
      [{ run: "bbbb2222", case: "order", attempt: 1, scorer: "faithfulness", label: "pass" }, 404, /no score from/],
      [{ run: "zzzz", case: "order", attempt: 1, scorer: "llmJudge", label: "pass" }, 404, /No run matching/],
      [{ run: "bbbb2222", case: "order", attempt: 1, scorer: "llmJudge", label: "maybe" }, 400, /label/],
      [{ run: "bbbb2222", case: "order", attempt: 1.5, scorer: "llmJudge", label: "pass" }, 400, /attempt/],
      [{ run: "bbbb2222", case: "order", attempt: 1, scorer: "llmJudge", label: "pass", extra: 1 }, 400, /extra/],
      [[], 400, /Invalid label/],
    ];
    for (const [body, status, msg] of cases) {
      const r = await putLabel(body);
      expect(r.status, JSON.stringify(body)).toBe(status);
      expect(r.json.error.message).toMatch(msg);
    }
    expect(store.listLabels()).toEqual([]);
  });

  it("answers 501 for label routes when the store keeps no labels", async () => {
    await dash.close();
    const bare: Store = { createRun: () => {}, saveAttempt: () => {}, finishRun: () => {}, getRun: (r) => store.getRun(r), listRuns: (o) => store.listRuns(o), getAttempts: (r, o) => store.getAttempts(r, o), close: () => {} };
    dash = await startDashboard({ store: bare, version: "t", port: 0 });
    expect((await api("GET", "/labels")).status).toBe(501);
    expect((await api("GET", "/calibration")).status).toBe(501);
    expect((await api("GET", "/runs/bbbb2222")).json.labels).toEqual([]);
  });
});

describe("dashboard page", () => {
  const html = renderDashboard({ version: "1.2.3", db: "</script><b>x" });
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1] as string);

  it("embeds config safely and its scripts parse", () => {
    expect(html).not.toContain("</script><b>x");
    expect(html).toContain("\\u003c/script\\u003e");
    for (const s of scripts.filter((x) => !x.startsWith("{"))) expect(() => new Function(s)).not.toThrow();
  });

  it("uses no blocking dialogs and inserts data only as text", () => {
    expect(DASHBOARD_JS).not.toMatch(/confirm\(|alert\(|prompt\(/);
    expect(DASHBOARD_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(DASHBOARD_JS).toContain("method: 'DELETE'");
    expect(DASHBOARD_JS).toContain("credentials: 'same-origin'");
  });
});
