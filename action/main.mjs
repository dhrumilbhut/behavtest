// The Regrade GitHub Action (see action.yml). Plain Node.js, no dependencies.
// It installs the Regrade version matching this action's tag, runs the suite, compares it with the
// baseline, writes the job summary, outputs and an optional pull request comment, and records the exit
// code for the final step (so the report artifact is uploaded even when the gate fails).
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
const actionPath = env.GITHUB_ACTION_PATH ?? resolve(import.meta.dirname, "..");
const input = (name) => (env[`RG_${name}`] ?? "").trim();

const GATES = new Set(["regression", "significant", "cases", "none"]);
const COMMENT_LIMIT = 60_000;

/** Split an arguments string like a shell would, for quotes only (no expansion). */
export function splitArgs(s) {
  const out = [];
  let cur = "";
  let quote = null;
  let has = false;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else cur += ch;
  }
  if (quote) throw new Error(`unclosed ${quote} in args`);
  if (has || cur) out.push(cur);
  return out;
}

/** One line, safe inside a workflow command (`::error::...`). */
export const oneLine = (s) => String(s).replace(/%/g, "%25").replace(/\r?\n/g, " ").slice(0, 900);

function setOutput(name, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}<<__RG_EOF__\n${value}\n__RG_EOF__\n`);
}
function summary(text) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  else process.stdout.write(`${text}\n`);
}
const group = (title) => process.stdout.write(`::group::${title}\n`);
const endGroup = () => process.stdout.write("::endgroup::\n");

/** The CLI to run: this checkout's build when present (the action testing itself), else the matching npm release. */
function resolveCli(tmp) {
  const local = join(actionPath, "dist", "cli.js");
  if (existsSync(local)) return local;
  const version = JSON.parse(readFileSync(join(actionPath, "package.json"), "utf8")).version;
  const prefix = join(tmp, "cli");
  group(`Install regrade@${version}`);
  // fixed arguments only (no user input), so running npm through the shell is safe on every OS
  const r = spawnSync(`npm install --no-save --no-audit --no-fund --loglevel=error --prefix "${prefix}" regrade@${version}`, { shell: true, stdio: "inherit" });
  endGroup();
  if (r.status !== 0) throw new Error(`could not install regrade@${version} from npm`);
  return join(prefix, "node_modules", "regrade", "dist", "cli.js");
}

function regrade(cli, args, title) {
  group(title);
  const r = spawnSync(process.execPath, [cli, ...args], { stdio: ["ignore", "inherit", "pipe"], env: { ...env, CI: "1" }, encoding: "utf8" });
  if (r.stderr) process.stderr.write(r.stderr);
  endGroup();
  return { code: r.status ?? 1, stderr: r.stderr ?? "" };
}

const hint = (status) =>
  status === 403 || status === 404 ? ": the workflow needs `permissions: pull-requests: write` (pull requests from forks get a read-only token)" : "";

async function comment(body) {
  const event = env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH) ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
  const number = event.pull_request?.number;
  if (!number) {
    process.stdout.write("comment: not a pull request event, so no comment was posted.\n");
    return;
  }
  const api = env.GITHUB_API_URL ?? "https://api.github.com";
  const repo = env.GITHUB_REPOSITORY;
  const headers = { Authorization: `Bearer ${input("TOKEN")}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  const marker = `<!-- regrade-action:${env.GITHUB_JOB ?? ""}:${input("SUITE")} -->`;
  const text = `${marker}\n${body.length > COMMENT_LIMIT ? `${body.slice(0, COMMENT_LIMIT)}\n\n… (truncated; the full summary is in the workflow run)` : body}`;
  let existing;
  for (let page = 1; page <= 5 && !existing; page++) {
    const r = await fetch(`${api}/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`, { headers });
    if (!r.ok) throw new Error(`listing comments: HTTP ${r.status}${hint(r.status)}`);
    const list = await r.json();
    existing = list.find((c) => typeof c.body === "string" && c.body.startsWith(marker));
    if (list.length < 100) break;
  }
  const r = existing
    ? await fetch(`${api}/repos/${repo}/issues/comments/${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ body: text }) })
    : await fetch(`${api}/repos/${repo}/issues/${number}/comments`, { method: "POST", headers, body: JSON.stringify({ body: text }) });
  if (!r.ok) {
    throw new Error(
      `HTTP ${r.status}${hint(r.status)}`,
    );
  }
  process.stdout.write(`comment: ${existing ? "updated" : "posted"} on #${number}\n`);
}

export async function main() {
  const suite = input("SUITE");
  const gate = input("GATE") || "regression";
  const baseline = input("BASELINE") || "regrade.baseline.json";
  const done = (result, exitCode, message) => {
    setOutput("result", result);
    setOutput("exit-code", String(exitCode));
    setOutput("message", oneLine(message));
    return { result, exitCode, message };
  };
  if (!suite) return done("error", 2, "The `suite` input is required.");
  if (!GATES.has(gate)) return done("error", 2, `Unknown gate "${gate}": use regression, significant, cases or none.`);

  const tmp = join(env.RUNNER_TEMP ?? resolve(".regrade"), `regrade-action-${env.GITHUB_JOB ?? "job"}-${Date.now()}`);
  const out = join(tmp, "artifact");
  mkdirSync(out, { recursive: true });
  const slug = (s) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  setOutput("artifact-dir", out);
  setOutput("artifact-name", input("ARTIFACT_NAME") || slug(`regrade-${env.GITHUB_JOB ?? "job"}-${env.RUNNER_OS ?? "local"}-${basename(suite).replace(/\.[^.]+$/, "")}`));

  let cli;
  let extra;
  try {
    cli = resolveCli(tmp);
    extra = splitArgs(input("ARGS"));
  } catch (err) {
    return done("error", 2, `Regrade could not start: ${err.message}`);
  }

  // 1. run
  const runFile = join(out, "run.json");
  const runArgs = ["run", suite, "--export", runFile, "--md", join(out, "run.md")];
  if (input("REPEAT")) runArgs.push("--repeat", input("REPEAT"));
  if (input("MIN_PASS_RATE")) runArgs.push("--min-pass-rate", input("MIN_PASS_RATE"));
  if (input("JUDGE")) runArgs.push("--judge", input("JUDGE"));
  runArgs.push(...extra);
  const run = regrade(cli, runArgs, `regrade ${runArgs.join(" ")}`);
  if (run.code === 2 || run.code === 130 || !existsSync(runFile)) {
    const why = run.stderr.trim().split("\n").slice(-3).join(" ") || `regrade run exited ${run.code}`;
    summary(`### Regrade: error\n\n\`\`\`\n${run.stderr.trim().slice(-4000) || why}\n\`\`\``);
    return done("error", run.code === 130 ? 130 : 2, why);
  }
  const runId = JSON.parse(readFileSync(runFile, "utf8")).run?.runId ?? "";
  setOutput("run-id", runId);

  // 2. compare with the baseline
  const hasBaseline = existsSync(baseline);
  let compareCode = 0;
  let regressed = "";
  if (hasBaseline) {
    const cmpArgs = ["compare", baseline, runFile, "--md", join(out, "compare.md"), "--json", join(out, "compare.json")];
    if (gate === "regression") cmpArgs.push("--fail-on-regression");
    if (gate === "significant") cmpArgs.push("--significant-only");
    const cmp = regrade(cli, cmpArgs, "regrade compare (baseline → this run)");
    if (cmp.code === 2) return done("error", 2, cmp.stderr.trim().split("\n").slice(-2).join(" ") || "regrade compare failed");
    compareCode = cmp.code;
    try {
      regressed = String(JSON.parse(readFileSync(join(out, "compare.json"), "utf8")).comparison.counts.regressed);
    } catch {
      regressed = "";
    }
  }
  setOutput("regressed", regressed);

  // 3. report
  const report = join(out, "report.html");
  const repArgs = ["report", runFile, "--out", report, ...(hasBaseline ? ["--against", baseline] : [])];
  if (regrade(cli, repArgs, "regrade report").code === 0) setOutput("report-path", report);

  // 4. decide
  let failed = false;
  if (gate === "cases") failed = run.code !== 0;
  else if (gate !== "none" && hasBaseline) failed = compareCode !== 0;
  const result = failed ? "fail" : "pass";
  const why =
    gate === "cases"
      ? failed ? "some cases failed, were flaky or errored" : "every case passed"
      : gate === "none" ? "gate: none" : !hasBaseline ? "no baseline to compare with yet" : failed ? `the ${gate} gate failed against ${baseline}` : `no regression against ${baseline}`;

  // 5. summary and comment
  const md = readFileSync(join(out, hasBaseline ? "compare.md" : "run.md"), "utf8");
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : "";
  const noBaseline = hasBaseline
    ? ""
    : `\n> **No baseline yet** (\`${baseline}\`), so nothing was compared. Create one from a good run and commit it:\n> \`npx regrade run ${suite} --export ${baseline} --compact\`\n`;
  const body = `### Regrade: ${result === "pass" ? "✅ pass" : "❌ fail"} (${why})\n${noBaseline}\n${md}\n${runUrl ? `\n[Workflow run and HTML report](${runUrl})\n` : ""}`;
  summary(body);
  if (input("COMMENT") === "true") {
    try {
      await comment(body);
    } catch (err) {
      process.stdout.write(`::warning title=Regrade::Could not comment on the pull request: ${oneLine(err.message)}\n`);
    }
  }
  return done(result, failed ? 1 : 0, failed ? `Regrade: ${why}` : "");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (r) => process.stdout.write(`regrade action: ${r.result}${r.message ? ` (${r.message})` : ""}\n`),
    (err) => {
      process.stdout.write(`::error title=Regrade::${oneLine(err?.stack ?? err)}\n`);
      setOutput("result", "error");
      setOutput("exit-code", "2");
      setOutput("message", oneLine(`internal error: ${err?.message ?? err}`));
    },
  );
}
