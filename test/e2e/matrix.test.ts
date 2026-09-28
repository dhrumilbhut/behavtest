import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const cli = join(root, "dist", "cli.js");
let dir: string;

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, NO_COLOR: "1", CI: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", rej);
    child.on("close", (code) => res({ code, stdout, stderr }));
  });
}

// three function pipelines of different quality; deterministic by attempt number
const SUITE = `
const answer = (every) => ({
  name: "p" + every,
  config: { every },
  run: (input, ctx) => (ctx.attempt % every === 0 ? String(input).toUpperCase() : "no idea"),
});
export default {
  name: "matrix-e2e",
  pipeline: answer(1),
  variants: [
    { name: "always" },
    { name: "half", pipeline: answer(2) },
    { name: "never", pipeline: answer(99) },
  ],
  defaults: { repeat: 2 },
  cases: ["alpha", "beta", "gamma"].map((id) => ({ id, input: id, expected: id.toUpperCase(), scorers: ["exactMatch"] })),
};
`;

beforeAll(() => {
  expect(existsSync(cli), "dist/cli.js is missing: run `npm run build`").toBe(true);
  dir = mkdtempSync(join(tmpdir(), "regrade-matrix-"));
  writeFileSync(join(dir, "suite.mjs"), SUITE);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("matrix runs (built binary)", () => {
  it("runs every variant, prints the call count and the side-by-side table, and exits 1 when a variant fails", async () => {
    const r = await runCli(["run", "suite.mjs", "--md", "m.md", "--json", "m.json"]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("matrix: 3 variants × 3 cases = 18 pipeline calls (always, half, never)");
    expect(r.stdout).toContain("matrix-e2e [half]");
    expect(r.stdout).toMatch(/always \*\s+p1\s+100%/);
    expect(r.stdout).toMatch(/never\s+p99\s+0%.*-100\.0 pts.*significantly worse/);
    const json = JSON.parse(readFileSync(join(dir, "m.json"), "utf8")) as { variants: Array<{ variant: string }>; reference: string };
    expect(json.variants.map((v) => v.variant)).toEqual(["always", "half", "never"]);
    expect(readFileSync(join(dir, "m.md"), "utf8")).toContain("## Regrade matrix: matrix-e2e");
  });

  it("regrade matrix shows the latest matrix against any reference, lists matrices and writes a report", async () => {
    const r = await runCli(["matrix", "--reference", "half", "--out", "matrix.html"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/always\s+p1\s+100%.*\+50\.0 pts/);
    expect(readFileSync(join(dir, "matrix.html"), "utf8")).toContain('id="regrade-data"');
    const list = await runCli(["matrix", "--list"]);
    expect(list.stdout).toMatch(/matrix-e2e {2}always, half, never/);
    const bad = await runCli(["matrix", "--reference", "nope"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('no variant "nope"');
  });

  it("--variant runs a subset; --export needs a single variant; runs and compare show the variant", async () => {
    const two = await runCli(["run", "suite.mjs", "--variant", "always", "--variant", "never", "--export", "x.json"]);
    expect(two.code).toBe(2);
    expect(two.stderr).toContain("--export writes one run");
    const one = await runCli(["run", "suite.mjs", "--variant", "half", "--export", "half.json", "--compact"]);
    expect(one.code).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, "half.json"), "utf8")).run.variant).toBe("half");
    const cmp = await runCli(["compare"]);
    expect(cmp.stdout).toMatch(/base .*\[half\]/);
    expect(cmp.stdout).toMatch(/head .*\[half\]/);
    const runs = await runCli(["runs"]);
    expect(runs.stdout).toContain("[never]");
    const unknown = await runCli(["run", "suite.mjs", "--variant", "nope"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("unknown variant nope");
  });
});
