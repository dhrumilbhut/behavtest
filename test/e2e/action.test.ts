import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error -- plain JavaScript module without types
import { oneLine, splitArgs } from "../../action/main.mjs";

const root = resolve(import.meta.dirname, "..", "..");
const script = join(root, "action", "main.mjs");
const dirs: string[] = [];

// quality comes from the environment, so one suite can be healthy (baseline) or broken (a pull request)
const SUITE = `
export default {
  name: "action-e2e",
  pipeline: { name: "qa", run: (input) => ((process.env.QUALITY === "broken" && input !== "one") || (process.env.QUALITY === "one-case" && input === "two") ? "no idea" : String(input).toUpperCase()) },
  cases: ["one", "two", "three", "four", "five"].map((id) => ({ id, input: id, expected: id.toUpperCase(), scorers: ["exactMatch"] })),
};
`;

interface ActionResult { code: number | null; stdout: string; outputs: Record<string, string>; summary: string; dir: string }

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "behavtest-action-"));
  dirs.push(dir);
  writeFileSync(join(dir, "suite.mjs"), SUITE);
  return dir;
}

/** Run the action script the way action.yml does: BT_* inputs, GitHub's file-based outputs, cwd = working-directory. */
function action(dir: string, inputs: Record<string, string>, extraEnv: Record<string, string> = {}): Promise<ActionResult> {
  const out = join(dir, `outputs-${Date.now()}-${Math.random()}.txt`);
  const sum = join(dir, `summary-${Date.now()}-${Math.random()}.md`);
  writeFileSync(out, "");
  writeFileSync(sum, "");
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NO_COLOR: "1",
    GITHUB_ACTION_PATH: root, // dist/ exists here, so the action uses this build
    GITHUB_OUTPUT: out,
    GITHUB_STEP_SUMMARY: sum,
    RUNNER_TEMP: dir,
    GITHUB_JOB: "test",
    RUNNER_OS: "Test",
    ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`BT_${k}`, v])),
    ...extraEnv,
  };
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [script], { cwd: dir, env });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stdout += d));
    child.on("error", rej);
    child.on("close", (code) => {
      const outputs: Record<string, string> = {};
      for (const m of readFileSync(out, "utf8").matchAll(/^([\w-]+)<<__BT_EOF__\n([\s\S]*?)\n__BT_EOF__$/gm)) outputs[m[1]!] = m[2]!;
      res({ code, stdout, outputs, summary: readFileSync(sum, "utf8"), dir });
    });
  });
}

/** Make a committed baseline from a healthy run. */
async function withBaseline(dir: string): Promise<void> {
  const r = await action(dir, { SUITE: "suite.mjs", GATE: "none", REPEAT: "3" });
  expect(r.outputs.result).toBe("pass");
  writeFileSync(join(dir, "behavtest.baseline.json"), readFileSync(join(r.outputs["artifact-dir"]!, "run.json")));
}

beforeAll(() => expect(existsSync(join(root, "dist", "cli.js")), "run `npm run build`").toBe(true));
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("action helpers", () => {
  it("splits arguments like a shell (quotes only) and keeps workflow commands on one line", () => {
    expect(splitArgs(`--tag smoke  --label "prompt v2" --x '' --y=a"b c"`)).toEqual(["--tag", "smoke", "--label", "prompt v2", "--x", "", "--y=ab c"]);
    expect(splitArgs("   ")).toEqual([]);
    expect(() => splitArgs(`--label "open`)).toThrow(/unclosed/);
    expect(oneLine("50% done\nnext::error::x")).toBe("50%25 done next::error::x");
  });
});

describe("the action script", () => {
  it("without a baseline: runs, passes, explains how to make one, and leaves the report files", async () => {
    const dir = project();
    const r = await action(dir, { SUITE: "suite.mjs", GATE: "regression" });
    expect(r.outputs).toMatchObject({ result: "pass", "exit-code": "0", regressed: "", "artifact-name": "behavtest-test-Test-suite" });
    expect(r.outputs["run-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.summary).toContain("No baseline yet");
    expect(r.summary).toContain("npx behavtest run suite.mjs --export behavtest.baseline.json --compact");
    for (const f of ["run.json", "run.md", "report.html"]) expect(existsSync(join(r.outputs["artifact-dir"]!, f)), f).toBe(true);
    expect(r.outputs["report-path"]).toBe(join(r.outputs["artifact-dir"]!, "report.html"));
  });

  it("with a baseline: a healthy change passes; a broken one fails the regression gate with the count", async () => {
    const dir = project();
    await withBaseline(dir);
    const ok = await action(dir, { SUITE: "suite.mjs", REPEAT: "3" });
    expect(ok.outputs).toMatchObject({ result: "pass", "exit-code": "0", regressed: "0" });
    expect(ok.summary).toContain("no regression against behavtest.baseline.json");

    const bad = await action(dir, { SUITE: "suite.mjs", REPEAT: "3" }, { QUALITY: "broken" });
    expect(bad.outputs).toMatchObject({ result: "fail", "exit-code": "1", regressed: "4" });
    expect(bad.outputs.message).toContain("the regression gate failed");
    expect(bad.summary).toContain("❌ fail");
    expect(bad.summary).toContain("## BehavTest compare · action-e2e");
    expect(readFileSync(bad.outputs["report-path"]!, "utf8")).toContain("behavtest-data");
  });

  it("still finds a baseline committed under the name from before the rename (regrade.baseline.json)", async () => {
    const dir = project();
    await withBaseline(dir);
    renameSync(join(dir, "behavtest.baseline.json"), join(dir, "regrade.baseline.json"));
    const bad = await action(dir, { SUITE: "suite.mjs", REPEAT: "3" }, { QUALITY: "broken" });
    expect(bad.outputs).toMatchObject({ result: "fail", "exit-code": "1", regressed: "4" });
    expect(bad.summary).toContain("regrade.baseline.json");
  });

  it("gates: significant needs significance, cases looks only at this run, none never fails", async () => {
    const dir = project();
    await withBaseline(dir);
    // one case, one attempt: 3/3 -> 0/1 is a regression, but significant neither for the case nor overall
    const reg = await action(dir, { SUITE: "suite.mjs", GATE: "regression", REPEAT: "1" }, { QUALITY: "one-case" });
    expect(reg.outputs).toMatchObject({ result: "fail", regressed: "1" });
    const sig = await action(dir, { SUITE: "suite.mjs", GATE: "significant", REPEAT: "1" }, { QUALITY: "one-case" });
    expect(sig.outputs).toMatchObject({ result: "pass", regressed: "1" });
    // four cases dropping is significant overall, so that gate fails too
    const sig4 = await action(dir, { SUITE: "suite.mjs", GATE: "significant", REPEAT: "3" }, { QUALITY: "broken" });
    expect(sig4.outputs.result).toBe("fail");
    const cases = await action(dir, { SUITE: "suite.mjs", GATE: "cases" }, { QUALITY: "broken" });
    expect(cases.outputs).toMatchObject({ result: "fail", "exit-code": "1" });
    const rate = await action(dir, { SUITE: "suite.mjs", GATE: "cases", MIN_PASS_RATE: "0.1" }, { QUALITY: "broken" });
    expect(rate.outputs.result).toBe("pass");
    const none = await action(dir, { SUITE: "suite.mjs", GATE: "none" }, { QUALITY: "broken" });
    expect(none.outputs).toMatchObject({ result: "pass", "exit-code": "0" });
  });

  it("configuration errors fail with exit code 2 and a one-line message", async () => {
    const dir = project();
    const missing = await action(dir, { SUITE: "nope.json" });
    expect(missing.outputs).toMatchObject({ result: "error", "exit-code": "2" });
    expect(missing.outputs.message).toMatch(/nope\.json/);
    expect(missing.outputs.message).not.toContain("\n");
    expect((await action(dir, { SUITE: "suite.mjs", GATE: "sometimes" })).outputs.message).toContain('Unknown gate "sometimes"');
    expect((await action(dir, { SUITE: "suite.mjs", ARGS: `--label "open` })).outputs.message).toContain("unclosed");
    expect((await action(dir, { SUITE: "suite.mjs", ARGS: "--no-such-flag" })).outputs["exit-code"]).toBe("2");
    expect((await action(dir, {})).outputs.message).toContain("`suite` input is required");
  });
});

describe("pull request comment", () => {
  let server: Server;
  let url: string;
  const comments: Array<{ id: number; body: string }> = [];
  const calls: string[] = [];
  let forbid = false;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        calls.push(`${req.method} ${req.url} ${req.headers.authorization}`);
        if (forbid) {
          res.writeHead(403).end("{}");
          return;
        }
        if (req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(comments));
        } else if (req.method === "POST") {
          comments.push({ id: comments.length + 1, body: JSON.parse(body).body });
          res.writeHead(201).end("{}");
        } else {
          const id = Number(req.url!.split("/").pop());
          comments.find((c) => c.id === id)!.body = JSON.parse(body).body;
          res.writeHead(200).end("{}");
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  afterEach(() => {
    forbid = false;
  });

  it("posts one comment per job and suite, then updates it; a refused token only warns", async () => {
    const dir = project();
    const event = join(dir, "event.json");
    writeFileSync(event, JSON.stringify({ pull_request: { number: 7 } }));
    comments.push({ id: 99, body: "someone else's comment" });
    const gh = { GITHUB_API_URL: url, GITHUB_REPOSITORY: "o/r", GITHUB_EVENT_PATH: event, GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "123" };

    const first = await action(dir, { SUITE: "suite.mjs", COMMENT: "true", TOKEN: "t0k" }, gh);
    expect(first.stdout).toContain("comment: posted on #7");
    expect(calls.some((c) => c.startsWith("POST /repos/o/r/issues/7/comments Bearer t0k"))).toBe(true);
    await action(dir, { SUITE: "suite.mjs", COMMENT: "true", TOKEN: "t0k" }, { ...gh, QUALITY: "broken" });
    const ours = comments.filter((c) => c.body.startsWith("<!-- behavtest-action:test:suite.mjs -->"));
    expect(ours).toHaveLength(1);
    expect(ours[0]!.body).toContain("https://github.com/o/r/actions/runs/123");
    expect(comments.find((c) => c.id === 99)!.body).toBe("someone else's comment");

    forbid = true;
    const refused = await action(dir, { SUITE: "suite.mjs", COMMENT: "true", TOKEN: "t0k" }, gh);
    expect(refused.stdout).toMatch(/::warning title=BehavTest::Could not comment.*pull-requests: write/);
    expect(refused.outputs.result).toBe("pass");

    forbid = false;
    // a comment posted by the action before the rename from Regrade is taken over, not duplicated
    comments.push({ id: 50, body: "<!-- regrade-action:test:./suite.mjs -->\nold summary" });
    const before = comments.length;
    await action(dir, { SUITE: "./suite.mjs", COMMENT: "true", TOKEN: "t0k" }, gh);
    expect(comments).toHaveLength(before);
    expect(comments.find((c) => c.id === 50)!.body.startsWith("<!-- behavtest-action:test:./suite.mjs -->")).toBe(true);

    const push = await action(dir, { SUITE: "suite.mjs", COMMENT: "true" }, { ...gh, GITHUB_EVENT_PATH: join(dir, "missing.json") });
    expect(push.stdout).toContain("not a pull request event");
  });
});
