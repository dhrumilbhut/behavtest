import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startMockPipeline, type MockPipeline } from "../fixtures/mock-pipeline.js";
import { startStubJudge, type StubLlm } from "../fixtures/stub-llm.js";

const root = resolve(import.meta.dirname, "..", "..");
const cli = join(root, "dist", "cli.js");

function runCli(args: string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, NO_COLOR: "1", CI: "1", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", rej);
    child.on("close", (code) => res({ code, stdout, stderr }));
  });
}

let mock: MockPipeline;
let judge: StubLlm;
const dirs: string[] = [];
beforeAll(async () => {
  expect(existsSync(cli), "dist/cli.js is missing: run `npm run build`").toBe(true);
  mock = await startMockPipeline();
  judge = await startStubJudge(); // fails outputs containing WRONG, passes the rest
});
afterAll(async () => {
  await mock.close();
  await judge.close();
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("behavtest calibrate (built binary)", () => {
  it("measures the judge against labels from a real run, gates on kappa, and rejects a bad labels file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "behavtest-e2e5-"));
    dirs.push(cwd);
    writeFileSync(
      join(cwd, "suite.json"),
      JSON.stringify({
        name: "calib",
        defaults: { judge: "anthropic:claude-haiku-4-5" },
        pipeline: { adapter: "http", config: { url: "${PIPELINE_URL}" } },
        cases: [
          { id: "good", input: "ECHO:a fine answer", scorers: ["llmJudge"] },
          { id: "bad", input: "ECHO:a WRONG answer", scorers: ["llmJudge"] },
        ],
      }),
    );
    const env = { PIPELINE_URL: mock.url, ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: judge.anthropicBaseUrl };
    const r = await runCli(["run", "suite.json", "--repeat", "16"], cwd, env);
    const runId = /run ([0-9a-f]{8}) saved/.exec(r.stdout)![1]!;

    // the human agrees with the judge on everything except two "bad" attempts they would have passed
    const lines = [];
    for (let i = 1; i <= 16; i++) {
      lines.push(JSON.stringify({ run: runId, case: "good", attempt: i, label: "pass" }));
      lines.push(JSON.stringify({ run: runId, case: "bad", attempt: i, label: i <= 2 ? "pass" : "fail" }));
    }
    writeFileSync(join(cwd, "labels.jsonl"), `${lines.join("\n")}\n`);

    const ok = await runCli(["calibrate", "--labels", "labels.jsonl", "--min-kappa", "0.6", "--md", "calib.md"], cwd);
    expect(ok.stderr).toBe("");
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("32 labels, 32 matched");
    expect(ok.stdout).toContain("llmJudge · judge anthropic:claude-haiku-4-5");
    expect(ok.stdout).toContain("kappa 0.88");
    expect(ok.stdout).toContain("failed 2 of 18 you passed (false fail 11%)");
    expect(ok.stdout).toContain("Gate passed");
    expect(existsSync(join(cwd, "calib.md"))).toBe(true);

    const strict = await runCli(["calibrate", "--labels", "labels.jsonl", "--min-kappa", "0.95"], cwd);
    expect(strict.code).toBe(1);
    expect(strict.stdout).toContain("kappa 0.88 is below 0.95");

    writeFileSync(join(cwd, "bad.jsonl"), '{"run":"x","case":"good","label":"yes"}\n');
    const bad = await runCli(["calibrate", "--labels", "bad.jsonl"], cwd);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("line 1: label");
  });
});
