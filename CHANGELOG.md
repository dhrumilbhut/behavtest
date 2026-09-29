# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may include breaking changes).

## [Unreleased]

## Rename: Regrade → BehavTest

Regrade has been renamed to **BehavTest**. The package now focuses on behavioral regression testing for AI applications: detecting meaningful changes in how a nondeterministic LLM app, AI agent or RAG pipeline behaves, by running test cases repeatedly and analyzing the results statistically. It is the same tool: commands, options, the suite format, scorers and statistics are unchanged.

Users of the previous package should migrate from:

```bash
npm install regrade
```

to:

```bash
npm install behavtest
```

The old `regrade` package stays on npm, deprecated, with its versions and history; it gets no new releases. Entries below this one describe releases made under the Regrade name and are left as they were.

### Changed
- **New names:** npm package and CLI `behavtest` (was `regrade`); GitHub repository and Action `dhrumilbhut/behavtest` (`uses: dhrumilbhut/behavtest@v0`); results database `.behavtest/results.db`; `behavtest init` writes `behavtest/`; environment variables `BEHAVTEST_JUDGE` and `BEHAVTEST_ASCII`; default report file `behavtest-report.html`; the Action's default baseline `behavtest.baseline.json`; run files are written with `"kind": "behavtest.run"`.
- **Library (breaking):** the run's version field is `behavtestVersion` (was `regradeVersion`) on `RunRecord`, in run files, and in the options of `runSuite` and `buildRunFile`. The base error class is `BehavTestError`.
- Documentation, the website, reports, the dashboard and the Action's summaries and comments use the new name.

### Kept working
- An existing `.regrade/results.db` is used, with a notice, while there is no `.behavtest/` folder.
- Run files written by Regrade (`"kind": "regrade.run"`, `regradeVersion`) load as before, so committed baselines keep working.
- The Action uses `regrade.baseline.json` when `behavtest.baseline.json` does not exist, and updates a pull request comment it posted under the old name instead of adding a new one.
- `REGRADE_JUDGE` and `REGRADE_ASCII` are read when the `BEHAVTEST_` variables are not set.
- `RegradeError` is still exported, as a deprecated alias of `BehavTestError`.
- Reports and the dashboard keep theme and label choices saved in the browser under the old name.

## [0.7.1]: GitHub Marketplace listing

### Fixed
- The GitHub Action's description was longer than the 125 characters the GitHub Marketplace allows, so the Action could not be listed. It is shorter now, and a test checks the Marketplace limits. No other changes.

## [0.7.0]: GitHub Action and matrix runs

Block the pull request that made results worse, and compare models or prompts side by side.

### Added
- **GitHub Action** (`uses: dhrumilbhut/regrade@v0`, `action.yml` at the repository root): runs the suite, compares it with a committed baseline, writes the comparison to the job summary, uploads the HTML report, run file and summaries as an artifact, and fails the check per `gate` (`regression` default, `significant`, `cases`, `none`; configuration errors always fail). Optional `comment: true` keeps one pull request comment up to date (per job and suite). Inputs `suite`, `baseline`, `repeat`, `min-pass-rate`, `judge`, `args`, `working-directory`, `report`, `artifact-name`; outputs `result`, `regressed`, `run-id`, `report-path`. It runs the Regrade release matching its tag; releases move the `v0` tag. A demo repository shows it passing one pull request and blocking another.
- **Matrix runs:** `variants` on a suite (JSON or code; each merged over `pipeline.config`, or with its own adapter or pipeline function) make `regrade run` run the suite once per variant, as ordinary runs grouped by a matrix id. The planned number of calls is printed first; `--variant` runs a subset. The judge and cases are the same for every variant.
- **`regrade matrix [id]`:** the variants side by side: attempt pass rate with Wilson intervals, cases passed, flaky cases, p95 latency, cost, a case × variant grid, and each variant against a reference (`--reference`, default the first) with the same permutation test and bootstrap interval as `compare`. `--list`, `--md`, `--json`, and `--out` for a single-file HTML report with a dot-and-interval chart.
- Dashboard: a **Matrix** page (chart, variant table, case grid linking to each run's case, reference picker), one pass-rate trend per variant, and variant names in the runs table.
- `examples/matrix/` (four OpenAI models on twelve questions) and `examples/github-action/` (a keyless suite and baseline).
- Library: `runMatrix`, `resolveVariant`, `selectVariants`, `mergeConfig`, `plannedAttempts`, `buildMatrix`, `loadMatrix`, `pickMatrix`, `renderMatrixConsole`, `renderMatrixMarkdown`, `renderMatrixHtml`; optional `Store.listMatrices` and `getMatrix`; `RunRecord.matrixId` / `variant` (all additive). The database schema moves to version 5 (`runs.matrix_id`, `runs.variant`); existing databases upgrade automatically.

### Fixed
- **TypeScript projects without `@types/node` failed to type-check** against 0.6.0's typings (`Cannot find module 'node:http'`), because `startDashboard` exposed Node.js server types. Its result no longer includes the Node `server` object, and `dashboardHandler` is no longer exported (it was internal to `regrade serve`). A test keeps Node.js types out of the published typings.

### Changed
- `regrade compare` with one run (or none) compares it with the previous run **of the same variant**; `compare`, `runs`, `show` and reports show a run's variant.
- README: GitHub Action and matrix sections; the CI recipes point to the Action (the CLI recipes remain for other CI systems).

## [0.6.0]: RAG scorers, judge calibration and a local dashboard

Test what a RAG pipeline retrieved and whether its answers stay grounded in it, measure whether the LLM judge agrees with you, and browse it all in a local dashboard. (0.5.0 was never published; its changes are included here.)

### Added
- **`regrade serve`: a local dashboard** on the results database, one page served by Node's own HTTP server (no new dependencies). **Runs** lists every run (outcome, label, git commit, cases passed, attempt pass rate, flaky cases, cost), filterable by suite, with a **pass-rate trend chart** per suite (each run's attempt pass rate and 95% Wilson interval; hover, arrow keys, click to open). **Run** is the HTML report's drill-down, with traces loaded per case. **Compare** runs the full comparison between any two runs. **Calibration** shows each judge's agreement, kappa and confusion matrix live, with the verdicts where it disagreed with you. `--port` (default 4800), `--host`, `--open`, `--db`. Light and dark themes.
- **Dashboard security:** listens on 127.0.0.1 by default; refuses requests whose `Host` is not localhost, an IP address or the configured host (DNS rebinding), refuses cross-site writes, serves a strict Content-Security-Policy with `nosniff` and no framing, and limits request sizes. A non-loopback `--host` prints a warning (there is no login).
- **Labels are stored in the results database** (new `labels` table, schema version 4; existing databases upgrade automatically). Labelling a judged answer in the dashboard saves it immediately.
- A versioned JSON API under `/api/v1` (runs, suites, one run, one case with its traces, compare, trend, calibration, labels).
- **`retrieval` scorer** (RAG): compares the documents an attempt retrieved (its `retrieval` trace steps) with a case's new optional `expectedDocs`: `metric` `hit`, `recall`, `precision` or `mrr`, optional `k` and `min`. Deterministic, no model. Retrieved documents may be `{ id, text, score }`, plain strings, or LangChain-style `{ pageContent, metadata }`.
- **`faithfulness` and `contextRelevance` scorers** (RAG, LLM judge): is the answer supported by the retrieved documents (`mode: "answer"` for one verdict, or `"claims"` to check each claim in the same single call, with `min`), and were the retrieved documents relevant to the question (per-document ratings, `min`). Retrieved documents are fenced as untrusted input like outputs; faithfulness never shows the judge the question (it judges support, not relevance), and document ids are listed outside the fenced data and enforced by the output schema. They share the judge machinery with `llmJudge`: structured output, fail-closed, temperature fallback, the pre-run check (now made once per judge per run, however many judge scorers use it) and the recorded judge model and temperature.
- **`regrade calibrate --labels labels.jsonl`**: how often an LLM judge agrees with your own pass/fail labels, per scorer, judge model and rubric: agreement (Wilson interval), Cohen's kappa (bootstrap interval), false-pass and false-fail rates, a confusion matrix. Unmatched labels, labels on errored verdicts and duplicates are reported. `--min-kappa` fails CI unless every judge has at least 30 labels and kappa at or above the threshold. `--json`, `--md`.
- **Label judge verdicts in the HTML report**: "Your label: Pass / Fail" buttons on every judged verdict, kept in the browser per run; **Export labels** downloads the JSONL that `regrade calibrate` reads (also Copy and a two-click Clear). The report stays one self-contained file.
- **Example RAG pipeline** (`examples/rag/`): a fictional store's policy documents, a keyword retriever and a deterministic answerer, with `healthy`, `degraded` (retrieval breaks) and `hallucinate` (unsupported claim) modes; HTTP server or importable module.
- Library: `retrievedDocs(trace)`; `Scorer.usesJudge` (additive: any judge-based scorer now makes the judge model part of a case's identity).
- Library: `startDashboard`, `dashboardHandler`, `handleApi`, `reportData` (the data the HTML report embeds); optional `Store.setLabel`, `deleteLabel` and `listLabels`, and `Store.getAttempts(runId, { caseId })` (all additive).

### Changed
- **`regrade calibrate` reads the labels saved in the database** when `--labels` is not given; `--labels <file>` still works.
- The HTML report's script is split into a UI library shared with the dashboard and a small report app. The report is still one self-contained file with the same features.
- **HTML report restyled** to match the documentation site: new light and dark palettes, larger type for the summary figures, accent-coloured filters and open cases, softer cards and code blocks. Same single self-contained file, same features. The report and the website now share the saved theme choice.
- Documentation website: redesigned landing page with light and dark themes and a theme toggle.

## [0.4.1]: documentation

No code changes: a rewritten README (which is what npm shows), a documentation website, and llms.txt.

### Changed
- **README rewritten** for people and for LLMs: a one-paragraph definition, when to use Regrade, three quickstarts (no key; an OpenAI/Anthropic prompt; your own HTTP service), task-oriented how-to guides, a glossary, an FAQ and rules for AI coding assistants. The reference sections are kept.
- **Documentation website** generated from the README (`npm run site`, `scripts/site.mts`): a landing page, one page per how-to guide and reference topic, FAQ structured data, `sitemap.xml`, `robots.txt`, `llms.txt` and `llms-full.txt` (llmstxt.org). The sample report moves to `/sample/`. npm description and keywords broadened.

## [0.4.0]: baselines and traces

Regrade in CI without a shared database, and a look inside what the agent did.

### Added
- **Baselines for CI: run files.** `regrade export <run>` and `regrade run --export <file>` write a portable, versioned run file that keeps every attempt's case hash. `--compact` keeps only what a comparison needs (no inputs, outputs, error text or judge reasoning), so a baseline is small and safe to commit. `compare` and `report --against` accept run files wherever they take a run id (`regrade compare base.json head.json` needs no database; a file alone is the baseline for the latest run of its suite), and `regrade import` loads a full run file into a database. The README has two GitHub Actions recipes: a committed baseline, and the latest run on main.
- **Traces.** The `steps` a pipeline reports (HTTP response, or a function pipeline's return value) are now stored with each attempt: values under secret-looking keys masked, step inputs/outputs over 20,000 characters clipped, at most 1,000 steps per attempt (anything cut is marked). `regrade show <run> <case>` prints the step tree (`--full` adds step inputs and outputs), the HTML report has a collapsible trace with timing bars, and full run files and the JSON report include traces. `--no-trace` stores none.
- **Trace scorers:** `toolCalled` (was a tool called, with `argsInclude` arguments, `times`, or `not`) and `maxSteps` (a step budget, optionally per `kind`). Without a trace they error, never pass.
- `tracer()` records steps with timings from code, nesting steps started inside a step.
- **The judge is checked before the run.** One trivial call per judge model before any case runs; a judge that cannot give a valid verdict stops the run with exit 2 and the reason, instead of erroring every attempt. `--no-judge-check` (or `judgeCheck: false` in the library) skips it.
- **Every judge verdict records which model produced it and at what temperature** (`0`, or `default` for models that reject 0), shown by `regrade show` and the HTML report. A judge that runs at its default temperature triggers a warning, since its verdicts can vary more between runs.
- Library: `buildRunFile`, `parseRunFile`, `readRunFile`, `writeRunFile`, `serializeRunFile`, `SqliteStore.importRun`; `tracer`, `prepareTrace`, `flattenTrace`, `toolCalled`, `maxSteps`; `Store.getAttempts(runId, { traces })` (additive).
- Library: a scorer's `preflight` may be async, and receives `signal`, `warn` and `liveChecks`; `ScoreResult.metadata` is stored with the score (all additive). The database schema moves to version 3 (`scores.metadata_json`; a `traces` table; cache-write and reasoning token columns); existing databases upgrade automatically.

### Fixed
- A registered scorer or adapter whose function returns a plain value instead of a Promise (easy to do in plain JavaScript) failed with "work.then is not a function"; plain values are now accepted.

### Changed
- `toolCalled` and `maxSteps` are now built-in names: an inline scorer in a code suite with one of those names must be renamed.

## [0.3.1]: first npm release

Fixes found by the first test against the real OpenAI API.

### Fixed
- **The LLM judge failed with many current OpenAI models** (for example `gpt-6-luna`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5-nano`): it always sent `temperature: 0`, which those models reject with HTTP 400. The judge still asks for temperature 0, and when a model rejects the parameter it asks again without it (for either provider) and skips the rejected attempt for the rest of the run. Other errors still fail closed.

### Changed
- **The judge model is now part of a judged case's identity**, so `regrade compare` reports cases judged by different models as `modified` instead of comparing verdicts from different judges. As a one-time effect, cases that use `llmJudge` will show as `modified` when compared with runs made by 0.3.0.
- OpenAI prices added for the GPT-6 (Sol, Luna), GPT-5.5, 5.4, 5.2, 5.1 and 5, GPT-4.1, GPT-4o and o4-mini families. Where the pricing page shows no cache-read or cache-write price, a call that uses one has unknown cost.
- **Node.js 24 is now the supported (and CI-tested) version**, down from a "22.14 or newer" claim that was never tested in CI. Support for Node 22 may return later; simple and honest for now.

## [0.3.0]: code suites

Write suites in code: score with your own functions and call your agent in-process.

### Added
- **Code suites:** `regrade run` accepts `.ts`, `.mts`, `.js` and `.mjs` files whose default export is a suite (or an async function returning one). Everything a JSON suite has, plus `scorers` (name → function returning a boolean or `{ pass, value, reasoning }`, or an object with `requiresExpected` / `preflight` / `fingerprint`) and a **function pipeline** (`pipeline: { name?, run, config? }`) that tests your agent in your own process with no HTTP server. `defineSuite()` and the `CodeSuite` type give editor completion.
- TypeScript is imported natively by Node's type stripping (**Node 22.18+**): no loader, no build step, no new dependency. Older Node versions get a clear error pointing at `.mjs` or JSON.
- `regrade init --ts` scaffolds a runnable code suite that needs no server and no API key.
- Inline scorers are fingerprinted from their source and the fingerprint is part of a case's identity, so editing a scorer makes `regrade compare` report the case as `modified` rather than as a regression. Case hashes of suites that use only built-in scorers are unchanged.
- Library: `loadSuiteFile`, `defineSuite`, `functionAdapter`, `toScorer`; `Scorer.fingerprint` (additive).
- SECURITY.md documents that code suites are programs, not data.

### Fixed
- **Timeouts and interrupts now bind for every adapter and scorer,** even user code that ignores its `AbortSignal` (a hung function or scorer becomes an errored attempt). Previously only cooperating code (HTTP calls, the judge) was cancelled.
- **A run can no longer exit silently with code 0 mid-run** when the only pending work is a promise that never settles (Node does not keep the event loop alive for `AbortSignal.timeout()` timers or pending promises); the runner now holds the loop open until it finishes.
- After a command finishes, a process kept alive by user code (a leaked interval or socket) is exited after a 2-second grace period, preserving the exit code.

## [0.2.0]: compare and report

Turns saved runs into a regression workflow: see what got worse, whether it is real, and share it.

### Added
- `regrade compare [base] [head]`: per-case pass rates with Wilson intervals, Fisher exact tests, and a case-stratified paired permutation test (with a within-case bootstrap interval) for the overall change. Cases that were modified, new, removed or errored are listed but never counted as regressions. `--fail-on-regression` / `--significant-only` gate CI (exit 1); `--json`, `--md`, `--all`, `--suite`.- `regrade runs` (list runs) and `regrade show <run> [case]` (run summary, or a case's input, outputs, scores and errors).
- `regrade report <run> [--against <base>]`: a single self-contained HTML report (no network, light/dark, filters, drill-down, comparison view). Untrusted pipeline output is only ever rendered as text.
- Markdown reports for job summaries and PR comments: `regrade run --md`, `regrade compare --md`.
- `--min-pass-rate <0-1>` on `run`: gate on the attempt-level pass rate instead of requiring every case to pass.
- OpenAI prices (`gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, short-context tier) and support for GPT-5.6 `cache_write_tokens`; price entries can carry `validUntil` so promotional prices expire (GPT-5.6 Sol's promotion ends 2026-11-21).
- JSON report cases now include the input snapshot, expected value and tags.
- `npm run sample-report` generates a deterministic sample comparison report (`site/`), and a workflow publishes it to GitHub Pages.
- Library exports: `compareRuns`, `regressionGate`, `renderHtmlReport`, `renderRunMarkdown`, `renderCompareMarkdown`, `renderComparison`, `wilsonInterval`, `fisherExact`, `stratifiedPermutationTest`, `stratifiedBootstrapInterval`.

### Fixed
- `runs` and `show` emitted ANSI colour codes when piped (commander defaults a negatable `--no-color` option to `true`).

### Known limitations
- OpenAI long-context pricing tiers are not modelled (short-context prices only).
- The HTML report's client script is checked for syntax and visually reviewed, but has no automated DOM tests.

## [0.1.0]: engine core

First release: run a suite against a pipeline, score the outputs, and save the run.

### Added
- `regrade run`: executes a JSON suite with bounded concurrency, per-attempt timeouts, retries (network/429/5xx), `--repeat`, `--tag`/`--case` filters, `--label`, incremental persistence, and Ctrl+C-safe partial results. Exit codes `0` / `1` / `2` / `130`.
- Adapters: `http` (any endpoint; optional self-reported cost/usage/steps), `openai` (Chat Completions-compatible, `baseUrl` override), `anthropic` (Messages API).
- Scorers: `exactMatch`, `llmJudge` (nonce-fenced untrusted input, native structured output, fail-closed, judge cost tracked), `latencyCost` (enforces `maxLatencyMs` / `maxCostUsd`).
- Cost engine pricing regular input, cache reads/writes and output separately; unknown models report unknown cost. User-supplied prices via suite `pricing` or `--prices`.
- SQLite store (`runs`, `results` per attempt, `scores`), WAL, foreign keys, versioned migrations, redacted stored config.
- Errored vs. failed attempt status; case verdicts `passed` / `failed` / `flaky` / `errored`.
- Console reporter (append-only, CI-safe) and a versioned JSON report (`--json`).
- `regrade init` (example suite + mock pipeline) and `regrade schema` (suite JSON Schema for editor autocomplete).
- Library API: `createRegistry`, `registerScorer`, `registerAdapter`, `loadSuite`, `runSuite`, `SqliteStore`.
- Test suite with a fault-injecting mock pipeline and stub LLM server; CI on Node 22/24 across Linux, macOS and Windows.
