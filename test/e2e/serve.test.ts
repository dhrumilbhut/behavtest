import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { summarize } from "../../src/core/verdict.js";
import { SqliteStore } from "../../src/store/sqliteStore.js";
import { attempt } from "../helpers.js";

const root = resolve(import.meta.dirname, "..", "..");
const cli = join(root, "dist", "cli.js");
const dirs: string[] = [];
const children: ChildProcess[] = [];

beforeAll(() => {
  expect(existsSync(cli), "dist/cli.js is missing: run `npm run build`").toBe(true);
});
afterEach(async () => {
  // wait for each server to exit: Windows keeps the database locked until then
  await Promise.all(children.splice(0).map((c) => { if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL"); return exited(c); }));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function dbWithRun(): string {
  const dir = mkdtempSync(join(tmpdir(), "regrade-serve-"));
  dirs.push(dir);
  const db = join(dir, "results.db");
  const s = new SqliteStore(db);
  const attempts = [attempt({ caseId: "order", scores: [{ scorerName: "llmJudge", pass: true, value: 1, metadata: { judge: "openai:x" } }] })];
  s.createRun({ runId: "run-serve-1", suiteName: "served", suiteHash: "h", startedAt: "2026-09-28T10:00:00.000Z", regradeVersion: "t", gitSha: null, gitDirty: null, label: null, pipeline: {} });
  s.saveAttempt("run-serve-1", attempts[0]!);
  s.finishRun("run-serve-1", "completed", "2026-09-28T10:00:01.000Z", summarize(attempts));
  s.close();
  return db;
}

/** Start `regrade serve` and resolve with the URL it prints. */
function serve(args: string[]): Promise<{ child: ChildProcess; url: string; out: () => string; err: () => string }> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [cli, "serve", ...args], { env: { ...process.env, NO_COLOR: "1" } });
    children.push(child);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => rej(new Error(`serve did not start:\n${stdout}\n${stderr}`)), 15_000);
    child.stdout!.on("data", (d) => {
      stdout += d;
      const m = /dashboard → (http:\/\/\S+)/.exec(stdout);
      if (m) {
        clearTimeout(timer);
        res({ child, url: m[1] as string, out: () => stdout, err: () => stderr });
      }
    });
    child.stderr!.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      rej(new Error(`serve exited ${code}:\n${stdout}\n${stderr}`));
    });
  });
}

function exited(c: ChildProcess): Promise<number | null> {
  return new Promise((r) => (c.exitCode !== null || c.signalCode !== null ? r(c.exitCode) : c.on("close", (code) => r(code))));
}

describe("regrade serve (built binary)", () => {
  it("serves the dashboard and API for a database, and labels written through it reach calibrate", async () => {
    const db = dbWithRun();
    const s = await serve(["--db", db, "--port", "0"]);
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await fetch(s.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("regrade-config");
    const runs = (await (await fetch(`${s.url}api/v1/runs`)).json()) as { runs: Array<{ runId: string }> };
    expect(runs.runs.map((r) => r.runId)).toEqual(["run-serve-1"]);
    const put = await fetch(`${s.url}api/v1/labels`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run: "run-serve", case: "order", attempt: 1, scorer: "llmJudge", label: "pass" }),
    });
    expect(put.status).toBe(200);
    if (process.platform !== "win32") {
      // Ctrl+C stops cleanly (Windows cannot deliver SIGINT to a child process)
      s.child.kill("SIGINT");
      expect(await exited(s.child)).toBe(0);
      expect(s.out()).toContain("stopping");
    } else {
      s.child.kill();
      await exited(s.child);
    }
    const store = new SqliteStore(db);
    try {
      expect(store.listLabels().map((l) => [l.runId, l.label])).toEqual([["run-serve-1", "pass"]]);
    } finally {
      store.close();
    }
  });

  it("warns when listening beyond this machine", async () => {
    const s = await serve(["--db", dbWithRun(), "--port", "0", "--host", "0.0.0.0"]);
    await new Promise((r) => setTimeout(r, 200));
    expect(s.err()).toMatch(/listening on 0\.0\.0\.0.*no login/s);
    expect(s.url).toMatch(/^http:\/\/localhost:\d+\/$/);
  });

  it("fails with exit code 2 when there is no database, or the port is taken", async () => {
    const dir = mkdtempSync(join(tmpdir(), "regrade-serve-"));
    dirs.push(dir);
    const none = spawn(process.execPath, [cli, "serve", "--db", join(dir, "missing.db")], { env: { ...process.env, NO_COLOR: "1" } });
    let err = "";
    none.stderr.on("data", (d) => (err += d));
    expect(await exited(none)).toBe(2);
    expect(err).toContain("No results database");
    expect(existsSync(join(dir, "missing.db"))).toBe(false);

    const db = dbWithRun();
    const first = await serve(["--db", db, "--port", "0"]);
    const port = new URL(first.url).port;
    const second = spawn(process.execPath, [cli, "serve", "--db", db, "--port", port], { env: { ...process.env, NO_COLOR: "1" } });
    children.push(second);
    let err2 = "";
    second.stderr.on("data", (d) => (err2 += d));
    expect(await exited(second)).toBe(2);
    expect(err2).toContain(`Port ${port} is in use`);
  });
});
