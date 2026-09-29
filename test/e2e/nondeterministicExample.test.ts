import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The README and the website quote numbers from examples/nondeterministic: this keeps them true.
const root = resolve(import.meta.dirname, "..", "..");
const cli = join(root, "dist", "cli.js");
let cwd: string;

function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string }> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, NO_COLOR: "1", CI: "1", ...env } });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("error", rej);
    child.on("close", (code) => res({ code, stdout }));
  });
}

const runId = async (label: string) => (await run(["runs"])).stdout.split("\n").find((l) => l.includes(label))!.trim().slice(0, 8);

beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), "behavtest-nondet-"));
  copyFileSync(join(root, "examples", "nondeterministic", "suite.mjs"), join(cwd, "suite.mjs"));
  await run(["run", "suite.mjs", "--label", "before"]);
  await run(["run", "suite.mjs", "--label", "same-bot"], { SEED: "2" });
  await run(["run", "suite.mjs", "--label", "worse-bot"], { BOT_ACCURACY: "0.6", SEED: "3" });
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe("examples/nondeterministic (numbers quoted in the docs)", () => {
  it("an unchanged bot moves case by case, but the overall change is not significant", async () => {
    const r = await run(["compare", await runId("before"), await runId("same-bot")]);
    expect(r.stdout).toContain("opening-hours 10/10 → 7/10");
    expect(r.stdout).toContain("refund-window 7/10 → 10/10");
    expect(r.stdout).toContain("attempt pass rate  85% [76%–91%] → 81% [71%–88%]");
    // the overall p-value is a Monte Carlo estimate seeded by the run ids: the docs quote it as ≈ 0.67
    const p = Number(/mean per case -3\.7 pts, 95% CI \[[^\]]+\], p=([\d.]+) → not significant/.exec(r.stdout)?.[1]);
    expect(p).toBeGreaterThan(0.6);
    expect(p).toBeLessThan(0.75);
    // any regressed case fails --fail-on-regression; --significant-only ignores noise
    expect((await run(["compare", await runId("before"), await runId("same-bot"), "--fail-on-regression"])).code).toBe(1);
    expect((await run(["compare", await runId("before"), await runId("same-bot"), "--fail-on-regression", "--significant-only"])).code).toBe(0);
  });

  it("a real drop in accuracy is a significant regression overall", async () => {
    const r = await run(["compare", await runId("before"), await runId("worse-bot"), "--fail-on-regression", "--significant-only"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("shipping-time 10/10 → 5/10 100% → 50%  p=0.033 significant");
    expect(r.stdout).toContain("support-email 9/10 → 5/10 90% → 50%  p=0.141");
    expect(r.stdout).toContain("attempt pass rate  85% [76%–91%] → 56% [45%–67%]");
    expect(r.stdout).toMatch(/mean per case -28\.7 pts, 95% CI \[-4\d\.\d pts, -1\d\.\d pts\], p=(<0\.0001|0\.000\d) → significant regression/); // the docs say p < 0.001
  });
});
