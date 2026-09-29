# BehavTest

**Behavioral regression testing for AI applications.**

[![npm](https://img.shields.io/npm/v/behavtest.svg)](https://www.npmjs.com/package/behavtest) [![CI](https://github.com/dhrumilbhut/behavtest/actions/workflows/ci.yml/badge.svg)](https://github.com/dhrumilbhut/behavtest/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**BehavTest tells you whether a change made your AI application behave worse.** It is an open-source command-line tool and Node.js library for developers who ship LLM apps, AI agents and RAG pipelines and change their prompts, models or retrieval settings. It runs your test cases through the real application several times, scores every answer, and compares the results with a baseline using statistical tests. The repeats matter because model output is nondeterministic: the same input can pass on one call and fail on the next, so a single before-and-after run mostly measures luck. BehavTest reports which cases really regressed, which are merely flaky, and whether the overall change is bigger than the noise, and it can fail your CI build when it is.

Try it in one command, with no API key: `npx behavtest init --ts && npx behavtest run behavtest/suite.mts`

**Previously known as Regrade.** The npm package, CLI and repository are now `behavtest`; see [migrating from Regrade](#migrating-from-regrade).

**[See a live sample report →](https://dhrumilbhut.github.io/behavtest/sample/)** (a healthy pipeline compared with a degraded one: which cases regressed, and is it real or noise?)

| | |
|---|---|
| **What it is** | A CLI (`behavtest`) and a TypeScript library for behavioral regression testing of LLM applications, AI agents and RAG pipelines |
| **Use it to** | Check a prompt or model change before shipping it, and block pull requests that make answers worse |
| **Tests** | Any HTTP service (Python, Node, Go...), OpenAI and OpenAI-compatible APIs (Azure, Ollama, vLLM, OpenRouter), Anthropic Claude, or an in-process function |
| **Scores with** | `exactMatch`, `llmJudge` (LLM-as-a-judge), `latencyCost`, `toolCalled`, `maxSteps`, RAG scorers (`retrieval`, `faithfulness`, `contextRelevance`), or your own functions |
| **Handles nondeterminism with** | Repeated attempts per case, flaky-case detection, Wilson intervals, Fisher's exact test and a case-stratified permutation test |
| **Checks the judge** | `behavtest calibrate` measures how often the LLM judge agrees with your own labels (Cohen's kappa) |
| **Browse results** | `behavtest serve`: a local dashboard with pass-rate trends, run comparison, labelling and judge calibration |
| **Runs in CI** | A GitHub Action (`dhrumilbhut/behavtest@v0`) that compares each pull request with a committed baseline, writes the job summary and fails the check on a regression; or the CLI in any CI |
| **Compares models** | Matrix runs: the same cases through several models or prompt versions, side by side with confidence intervals |
| **Needs** | Node.js 24 or newer. No hosted service, no account, no telemetry: results go to one local SQLite file |
| **License** | MIT |

## Contents

- [Why behavioral regression tests](#why-ai-applications-need-behavioral-regression-tests) · [How it works](#how-it-works) · [When to use BehavTest](#when-to-use-behavtest) · [Installation](#installation) · [Quickstart](#quickstart) · [How-to guides](#how-to-guides) · [Concepts](#concepts)
- Reference: [configuration](#configuration) · [suite format](#suite-format) · [adapters](#adapters-what-to-test) · [scorers](#scorers) · [LLM judge](#the-llm-judge) · [code suites](#code-suites-typescript-or-javascript) · [traces](#traces-check-what-the-agent-did-not-just-what-it-said) · [RAG](#rag-test-retrieval-and-grounded-answers) · [judge calibration](#judge-calibration-does-the-judge-agree-with-you) · [repeats](#non-determinism-repeat-your-cases) · [compare](#compare-runs-what-regressed-and-is-it-real) · [matrix runs](#matrix-runs-compare-models-and-prompts-side-by-side) · [GitHub Action](#github-action) · [baselines and CI](#baselines-and-ci-fail-the-pull-request-that-made-things-worse) · [reports](#reports) · [dashboard](#dashboard-browse-compare-and-label-runs) · [exit codes and storage](#exit-codes-and-storage) · [cost](#cost) · [CLI](#cli-reference) · [library](#library-api-and-custom-scorers)
- [Troubleshooting](#troubleshooting) · [Migrating from Regrade](#migrating-from-regrade) · [FAQ](#faq) · [For AI coding assistants](#for-ai-coding-assistants) · [Security and privacy](#security-and-privacy) · [Contributing](#contributing)

## Why AI applications need behavioral regression tests

### What problem does BehavTest solve?

You change a prompt, swap a model or tune retrieval, and something that used to work stops working: the bot no longer states the refund window, the agent calls the wrong tool, the RAG pipeline answers from the wrong document. Nothing crashes, so ordinary tests stay green, and you find out when a user complains. BehavTest turns "did this change make the application behave worse?" into a test you run before merging: the same cases, run the same way, compared with a known-good baseline.

### Why single runs and snapshots are not enough

Traditional regression tests assume the same input gives the same output. LLM applications break that assumption twice:

- **The exact wording changes on every call**, so a snapshot of the output fails on harmless rephrasing. BehavTest scores *behavior* instead (does the answer state the fact, call the right tool, stay grounded in the retrieved documents?), with deterministic checks where possible and an LLM judge where not.
- **Even the behavior is random.** A case can pass on one call and fail on the next. In the bundled [nondeterministic example](https://github.com/dhrumilbhut/behavtest/tree/main/examples/nondeterministic), a bot that is right 90% of the time was run twice with nothing changed: one case went from 10/10 to 7/10, another from 7/10 to 10/10. Compare single runs and you would chase that noise.

So BehavTest repeats each case, treats its behavior as a pass rate, and asks whether the rate moved by more than the noise. On that same example, the unchanged bot scored 85% then 81% (overall change p ≈ 0.67: not significant), while a bot whose accuracy really dropped to 60% scored 56% (p < 0.001: a significant regression).

### Who it is for

Developers and small teams who ship an LLM feature (a support bot, RAG search, an agent) and want a local, vendor-neutral check they can run on every change and in CI. It is not a hosted evaluation platform or production monitoring; see [prior art](#prior-art) for tools that are.

## How it works

A test run moves through the same stages every time:

```text
 Test definition      suite: cases, scorers, pipeline (JSON or TypeScript)
        |
 Execution            each case sent to your application: HTTP, OpenAI, Anthropic or a function
        |
 Repeated evaluation  --repeat N attempts per case
        |
 Result collection    every attempt, score and trace saved (SQLite, or a portable run file)
        |
 Behavioral scoring   scorers pass or fail each attempt; each case gets a verdict
        |             (passed, failed, flaky, errored)
        |
 Statistical analysis compare with the baseline: per-case pass rates with Wilson intervals and
        |             Fisher's exact test; overall change with a case-stratified permutation test
        |
 Regression decision  regressed / improved / flaky / not significant, per case and overall
        |
 Test result          report + exit code (0 passed, 1 regression or failure, 2 configuration error)
```

1. **Run** every test case through your real pipeline several times (`--repeat`), before and after a change.
2. **Score** every attempt: exact match, an LLM judge, latency and cost limits, the tool calls the agent made, or what a RAG pipeline retrieved and whether the answer is grounded in it.
3. **Save** every run, attempt, score and trace to a local SQLite file, or to a portable run file you commit as the baseline.
4. **Compare** the candidate run with the baseline case by case: Wilson intervals on each pass rate, Fisher's exact test per case, and a case-stratified permutation test (with a bootstrap interval) on the overall change.
5. **Decide:** a case that passes only sometimes is reported as flaky, a change within the noise is labelled not significant, and a real drop is a regression. `--fail-on-regression`, or the GitHub Action, fails the build.

A minimal suite, for a support bot served over HTTP. Each case names the behavior its answer must show:

```json
{
  "name": "support-bot",
  "defaults": { "repeat": 5, "judge": "openai:gpt-4.1-nano" },
  "pipeline": { "adapter": "http", "config": { "url": "${PIPELINE_URL:-http://localhost:4000/pipeline}" } },
  "cases": [
    { "id": "refund-window", "input": "Can I return an item after 40 days?",
      "scorers": ["llmJudge"],
      "scorerConfig": { "llmJudge": { "rubric": "Does the answer state the 30-day limit and avoid promising an exception?" } } },
    { "id": "capital", "input": "What is the capital of France?", "expected": "Paris", "scorers": ["exactMatch"] }
  ]
}
```

`behavtest run suite.json` sends each input to the endpoint five times, scores every answer and saves the run; after a change, `behavtest compare` runs the statistics against the previous run (or a committed baseline file).

What the decision looks like, from the [nondeterministic example](https://github.com/dhrumilbhut/behavtest/tree/main/examples/nondeterministic) after the bot's accuracy dropped from 90% to 60% (10 attempts per case; abridged; the overall p-value and interval are Monte Carlo estimates, so their last digits vary from run to run):

```
behavtest compare · support-bot
  ✗ regressed shipping-time 10/10 → 5/10 100% → 50%  p=0.033 significant
  ✗ regressed support-email 9/10 → 5/10 90% → 50%  p=0.141
      not statistically significant at this sample size
  ...
  attempt pass rate  85% [76%–91%] → 56% [45%–67%]  (8 comparable cases; descriptive)
  overall change     mean per case -28.7 pts, 95% CI [-41.3 pts, -16.3 pts], p=<0.0001 → significant regression
```

Each case on its own has only 10 attempts per side, so most per-case drops are "not significant"; the overall test pools the evidence across cases and is sure. Cases whose definition, scorer or judge changed between the two runs are reported as `modified` and never counted as regressions, so changing a test is not mistaken for a change in behavior. The details: [compare runs](#compare-runs-what-regressed-and-is-it-real).

## When to use BehavTest

Use BehavTest when:

- **You changed a prompt, a model or a retrieval setting** and want to know whether anything got worse before users notice.
- **You are switching models** (for example from GPT to Claude, or to a cheaper model) and need evidence that answers, latency and cost stay acceptable.
- **You want a CI check** that fails a pull request when it breaks your LLM feature, the way unit tests do for code.
- **Your agent calls tools**, and you need to test that it calls the right one with the right arguments, without looping.
- **You run a RAG pipeline**, and need to know whether it still retrieves the right documents and answers only from them.
- **You rely on an LLM judge**, and want evidence that it agrees with a human before you trust its scores.
- **Your outputs are nondeterministic**, so a single pass/fail is a coin flip and you need repeated attempts and a verdict on whether a change is real.
- **You want to stay vendor-neutral and local**: no hosted platform, no account, results in a file you own.

Something else may fit better if you need a hosted evaluation platform with a team UI, production observability and tracing of live traffic, or an extensive library of ready-made RAG metrics today. See [prior art](#prior-art).

## Installation

BehavTest needs **Node.js 24 or newer** (`node --version`). It runs on Linux, macOS and Windows.

```bash
npx behavtest --version          # run it without installing
npm install --global behavtest   # or install the CLI globally
npm install --save-dev behavtest # or add it to a project (needed only to import tracer / defineSuite)
```

Your application does not have to be written in JavaScript: BehavTest calls it over HTTP, or calls OpenAI-compatible and Anthropic models directly. Provider keys are read from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` only when a suite uses those providers or the LLM judge.

## Quickstart

Requires **Node.js 24 or newer** (see [installation](#installation)). Every command below also works with `npx behavtest`.

### 1. Try it with no API key

```bash
npx behavtest init --ts            # writes behavtest/suite.mts: a small suite with a stand-in agent
npx behavtest run behavtest/suite.mts
```

Or the JSON version, which tests a local mock HTTP service:

```bash
npx behavtest init                     # writes behavtest/suite.json and behavtest/mock-pipeline.mjs
node behavtest/mock-pipeline.mjs &     # start the mock pipeline (or use a second terminal)
npx behavtest run behavtest/suite.json
```

```
behavtest 0.8.0 · my-first-suite · http → localhost:4000/pipeline
  2 cases · concurrency 4

  ✓ capital-of-france     177 ms  exactMatch ✓  latencyCost ✓
  ✓ simple-math           175 ms  exactMatch ✓

  cases 2 · passed 2 · failed 0 · flaky 0 · errored 0
  latency avg 176 ms · p95 177 ms
  cost pipeline unknown

  All 2 cases passed.
  run 1219f529 saved → .behavtest/results.db
```

### 2. Test a prompt on OpenAI or Anthropic

Save as `prompt.suite.json`:

```json
{
  "$schema": "https://unpkg.com/behavtest/schema/suite.schema.json",
  "name": "support-prompt",
  "defaults": { "judge": "openai:gpt-4.1-nano", "repeat": 3 },
  "pipeline": {
    "adapter": "openai",
    "config": { "model": "gpt-6-luna", "system": "You are a concise support agent. Returns are accepted within 30 days." }
  },
  "cases": [
    {
      "id": "refund-window",
      "input": "Can I return an item after 40 days?",
      "expected": "No: returns are accepted within 30 days.",
      "scorers": ["llmJudge"]
    },
    { "id": "one-word", "input": "Reply with only the word OK.", "expected": "OK", "scorers": ["exactMatch"] }
  ]
}
```

```bash
export OPENAI_API_KEY=sk-...           # PowerShell: $env:OPENAI_API_KEY="sk-..."
npx behavtest run prompt.suite.json --label prompt-v1
# edit the system prompt, then:
npx behavtest run prompt.suite.json --label prompt-v2
npx behavtest compare                    # what changed between the two runs, and is it real?
```

For Claude, use `"adapter": "anthropic"`, a model such as `"claude-haiku-4-5"`, and `ANTHROPIC_API_KEY`.

### 3. Test your own service (any language)

Expose one endpoint that takes `{ "input": ... }` and returns `{ "output": "..." }`, then point a suite at it: see [test a Python, LangChain or other HTTP service](#test-a-python-langchain-or-other-http-service).

## How-to guides

### Check whether a prompt or model change made things worse

Run the suite before and after the change, with a few attempts per case, then compare:

```bash
behavtest run suite.json --repeat 5 --label before
# change the prompt, the model, the retrieval settings...
behavtest run suite.json --repeat 5 --label after
behavtest compare --fail-on-regression
```

`compare` lists regressed, improved, flaky and changed cases, with pass rates and p-values, and an overall verdict. See [compare](#compare-runs-what-regressed-and-is-it-real).

### Fail a GitHub pull request when LLM quality drops

Commit a compact baseline once:

```bash
behavtest run behavtest/suite.json --repeat 3 --export behavtest.baseline.json --compact
git add behavtest.baseline.json && git commit -m "Add BehavTest baseline"
```

Then add the [GitHub Action](#github-action) to a workflow that runs on pull requests:

```yaml
      - uses: dhrumilbhut/behavtest@v0
        with:
          suite: behavtest/suite.json
          repeat: 3
```

It compares every pull request with the baseline, writes the result to the job summary and fails the check when a case regresses. [See it block a pull request](https://github.com/dhrumilbhut/behavtest-demo/pulls). Other CI systems: [baselines and CI](#baselines-and-ci-fail-the-pull-request-that-made-things-worse).

### Compare models or prompt versions side by side

Add `variants` to the suite, each changing the pipeline's config, and run it once:

```json
"variants": [
  { "name": "gpt-4.1-nano" },
  { "name": "gpt-5.4-nano", "pipeline": { "config": { "model": "gpt-5.4-nano" } } }
]
```

```bash
behavtest run suite.json --repeat 3    # one run per variant
behavtest matrix --out matrix.html     # side by side: pass rate with intervals, cost, latency, each case
```

See [matrix runs](#matrix-runs-compare-models-and-prompts-side-by-side).

### Test a Python, LangChain or other HTTP service

BehavTest calls your service over HTTP, so it works with any language or framework (FastAPI, Flask, Express, LangChain, LlamaIndex...). The service needs one endpoint:

```python
# FastAPI example: POST {"input": ...} -> {"output": "..."}
from fastapi import FastAPI

app = FastAPI()

@app.post("/answer")
def answer(body: dict):
    answer = my_chain.invoke(body["input"])   # your LangChain chain, agent, or plain function
    return {"output": answer}
```

```json
{
  "name": "my-service",
  "pipeline": { "adapter": "http", "config": { "url": "${PIPELINE_URL:-http://localhost:8000/answer}" } },
  "cases": [{ "id": "greeting", "input": "Say hello", "scorers": ["llmJudge"] }],
  "defaults": { "judge": "anthropic:claude-haiku-4-5" }
}
```

The response may also include `costUsd`, `usage` (token counts) and `steps` (a trace of tool calls and LLM calls) for cost checks and [trace scorers](#traces-check-what-the-agent-did-not-just-what-it-said).

### Test that an AI agent calls the right tool

Return the agent's steps (from HTTP, or with `tracer()` in a function pipeline), then score them:

```json
"scorers": ["toolCalled", "maxSteps"],
"scorerConfig": {
  "toolCalled": { "tool": "lookup_order", "argsInclude": { "orderId": 123 } },
  "maxSteps": { "max": 8 }
}
```

See [traces](#traces-check-what-the-agent-did-not-just-what-it-said).

### Test a RAG pipeline: retrieval and grounded answers

Report the retrieved documents as a `retrieval` step (`output`: a list of `{ id, text }`, plain strings, or LangChain documents), list the ids each case should retrieve in `expectedDocs`, and combine the RAG scorers:

```json
{
  "id": "refund-time",
  "input": "How long does a refund take?",
  "expectedDocs": ["refunds"],
  "scorers": ["retrieval", "faithfulness", "contextRelevance"],
  "scorerConfig": { "retrieval": { "metric": "recall", "k": 3 }, "faithfulness": { "mode": "claims" } }
}
```

`retrieval` is deterministic (no model); `faithfulness` and `contextRelevance` use the judge. A complete, runnable example with a small store-policy corpus is in [`examples/rag`](https://github.com/dhrumilbhut/behavtest/tree/main/examples/rag). See [RAG](#rag-test-retrieval-and-grounded-answers).

### Check that the LLM judge agrees with you

Label some judged answers yourself (Pass/Fail buttons in the dashboard, saved to the results database), and measure the agreement:

```bash
behavtest serve --open                  # open a run, mark judged answers Pass or Fail
behavtest calibrate --min-kappa 0.6     # reads the labels you saved
```

See [judge calibration](#judge-calibration-does-the-judge-agree-with-you).

### See trends and browse runs in a dashboard

```bash
behavtest serve --open
```

A local web dashboard on the same database: pass rate per suite over time, every run with its cases, outputs, judge reasoning and traces, any two runs compared, and judge calibration from your labels. See [dashboard](#dashboard-browse-compare-and-label-runs).

### Use an LLM as a judge

Add `"llmJudge"` to a case's scorers, write a rubric in `scorerConfig.llmJudge.rubric`, and choose a judge model with `defaults.judge`, `--judge provider:model` or `BEHAVTEST_JUDGE`. Use a different model from the one being tested. See [the LLM judge](#the-llm-judge).

### Deal with flaky, non-deterministic outputs

Run each case several times with `--repeat 5`. A case that passes on some attempts and fails on others is labelled **flaky**. `compare` then decides whether a change in pass rate is bigger than the noise. See [repeats](#non-determinism-repeat-your-cases).

### Check latency and cost

Add `"latencyCost"` with `maxLatencyMs` and/or `maxCostUsd`. Cost comes from token usage and a bundled price table; unknown prices are reported as unknown, never guessed. See [cost](#cost).

## Concepts

| Term | Meaning |
|---|---|
| **Suite** | A JSON file (or a TypeScript/JavaScript module) listing the pipeline to test and the test cases |
| **Case** | One input, an optional expected answer, and the scorers to run. Its `id` must stay stable across runs |
| **Attempt** | One execution of a case. With `--repeat 5`, each case has 5 attempts |
| **Scorer** | A check on an attempt's output or trace; returns pass or fail (or an error if it could not evaluate) |
| **Verdict** | Per case: **passed** (all attempts pass), **failed** (none pass), **flaky** (a mix), **errored** (no verdict possible, e.g. pipeline down) |
| **Run** | One execution of a suite, saved with every attempt, score and trace |
| **Run file** | A portable JSON copy of a run; **compact** run files hold only what comparisons need and are safe to commit |
| **Baseline** | The run you compare against, usually a committed compact run file |
| **Trace** | The steps an attempt took (LLM calls, tool calls, retrievals), reported by the pipeline |
| **Expected docs** | The ids of the documents a RAG case should retrieve (`expectedDocs`), for the `retrieval` scorer |
| **Label** | Your own pass/fail on a judged answer, used by `behavtest calibrate` to measure the judge |
| **Variant** / **matrix** | A variant changes the pipeline's config (a model, a prompt); a matrix is one run per variant of the same cases, compared side by side |
| **Modified** | A case whose definition, scorer code or judge model changed between two runs; listed, never counted as a regression |

## Configuration

Everything about a run comes from four places: the suite file, per-case fields in it, command-line flags and environment variables. When two set the same thing, the more specific one wins:

| Setting | Resolved in this order (first one set wins) | Built-in default |
|---|---|---|
| Attempts per case | `--repeat` → the case's `repeat` → suite `defaults.repeat` | 1 |
| Timeout per attempt | `--timeout` → the case's `timeoutMs` → suite `defaults.timeoutMs` | 30,000 ms |
| Attempts in flight | `--concurrency` → suite `defaults.concurrency` | 4 |
| Judge model | the case's `scorerConfig.<scorer>.judge` → `--judge` → suite `defaults.judge` → `BEHAVTEST_JUDGE` | none (a judged case without one is a configuration error) |
| Model prices | `--prices <file>` → suite `pricing` → the bundled price table | bundled table |
| Results database | `--db <path>` | `.behavtest/results.db` |

- **Secrets and URLs** go in the environment, referenced from `pipeline.config` as `${VAR}` or `${VAR:-default}`; a missing variable stops the run before anything is sent. Provider keys are read from `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` (or the variable named by `apiKeyEnv`), and `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` redirect the built-in adapters.
- **Which cases run** is filtered with `--tag` and `--case` (both repeatable), and in a matrix suite `--variant`.
- **What gets saved** is controlled with `--no-trace` (don't store pipeline steps), `--label` (a name for the run) and `--export` / `--compact` (also write a run file).
- **Editor support:** add `"$schema": "https://unpkg.com/behavtest/schema/suite.schema.json"` to a JSON suite for autocomplete and validation; `behavtest schema` prints the same schema.

The fields of a suite are in [suite format](#suite-format), every flag is in the [CLI reference](#cli-reference), and each adapter's options are in [adapters](#adapters-what-to-test).

## Suite format

A suite is a JSON file. Add `"$schema"` for editor autocomplete and validation (`behavtest schema` prints the schema).

```json
{
  "$schema": "https://unpkg.com/behavtest/schema/suite.schema.json",
  "name": "support-bot",
  "description": "Regression suite for the support assistant",
  "defaults": { "judge": "anthropic:claude-sonnet-5", "repeat": 1, "timeoutMs": 30000, "concurrency": 4 },
  "pipeline": {
    "adapter": "http",
    "config": {
      "url": "${PIPELINE_URL:-http://localhost:4000/pipeline}",
      "headers": { "Authorization": "Bearer ${PIPELINE_TOKEN}" }
    }
  },
  "cases": [
    {
      "id": "refund-policy",
      "input": "Can I return an item after 40 days?",
      "expected": "No: returns are accepted within 30 days.",
      "tags": ["policy"],
      "scorers": ["llmJudge", "latencyCost"],
      "scorerConfig": {
        "llmJudge": { "rubric": "Does the answer state the 30-day limit and avoid promising an exception?" },
        "latencyCost": { "maxLatencyMs": 3000 }
      }
    },
    {
      "id": "order-status",
      "input": { "messages": [{ "role": "user", "content": "Where is order 123?" }] },
      "expected": "Your order shipped on Monday.",
      "scorers": ["exactMatch"],
      "repeat": 5
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `cases[].id` | Unique and **stable across runs**: it is how future comparisons match cases. Letters, digits, `.`, `_`, `-`. |
| `cases[].input` | A string, `{ "messages": [...] }` (chat history), or any object (sent as-is to HTTP pipelines; LLM adapters need `inputTemplate`). |
| `cases[].expected` | Reference answer. Required by `exactMatch`; optional context for `llmJudge`. |
| `cases[].expectedDocs` | Ids of the documents a correct retrieval returns, for the `retrieval` scorer. |
| `cases[].scorers` | Names of scorers to run. `scorerConfig.<name>` holds that scorer's options. |
| `cases[].tags` | Labels for filtering with `--tag`. |
| `cases[].repeat` / `timeoutMs` | Per-case overrides. CLI flags beat case values, which beat `defaults`. |
| `${VAR}` / `${VAR:-default}` | Environment placeholders, allowed in any string of `pipeline.config`. **Secrets belong here, never in the file.** A missing variable stops the run before anything is sent. |
| `pricing` | Optional extra/override model prices (see [cost](#cost)). |
| `variants` | Optional: run the suite once per variant (see [matrix runs](#matrix-runs-compare-models-and-prompts-side-by-side)). Each is `{ name, description?, pipeline?: { adapter?, config? } }`. |

Unknown keys are rejected, so typos like `scorer` (instead of `scorers`) fail loudly, with the JSON path.

## Adapters: what to test

### HTTP (any language, any framework)

BehavTest POSTs `{ "input": <case input> }` and expects `{ "output": "<string>" }`:

```json
{ "adapter": "http", "config": { "url": "http://localhost:8000/answer", "headers": { "X-Team": "search" } } }
```

Options: `url`, `method` (POST/PUT/PATCH), `headers`, `outputField` (default `output`), `retries`, `retryBaseDelayMs`.

The pipeline can also report `costUsd`, `usage`, `steps` (a trace) and `metadata` in its response. Cost and usage are used, and `steps` are stored and can be scored (see [traces](#traces-check-what-the-agent-did-not-just-what-it-said)).

### OpenAI (and anything OpenAI-compatible)

```json
{ "adapter": "openai", "config": { "model": "gpt-6-luna", "system": "Be concise.", "maxTokens": 300 } }
```

Reads `OPENAI_API_KEY`. Set `baseUrl` (or `OPENAI_BASE_URL`) to use Ollama, vLLM, OpenRouter, Azure, or a local stub. `temperature` is sent only if you set it (current OpenAI reasoning models accept only their default).

### Anthropic

```json
{ "adapter": "anthropic", "config": { "model": "claude-haiku-4-5", "system": "Be concise.", "maxTokens": 300 } }
```

Reads `ANTHROPIC_API_KEY` (and `ANTHROPIC_BASE_URL`). `maxTokens` defaults to 1024 because the API requires it.

Both LLM adapters accept `apiKeyEnv` (to name a different env var), `inputTemplate` (e.g. `"{{question}}"`, to turn an object input into a prompt), and `retries`. Retries happen only for network errors, HTTP 429 and 5xx (honouring `Retry-After`); latency is that of the final successful attempt.

### A function in your own process

Write the suite in TypeScript or JavaScript and give it `pipeline: { run: async (input) => ... }`: see [code suites](#code-suites-typescript-or-javascript).

## Scorers

| Scorer | What it does |
|---|---|
| `exactMatch` | Deterministic equality with `expected`. By default trimmed, whitespace-normalised and case-insensitive. Options: `caseSensitive`, `trim`, `normalizeWhitespace`. |
| `llmJudge` | Asks an LLM to judge the output against a rubric (`scorerConfig.llmJudge.rubric`, default: "does the output correctly and completely address the input, matching the intent of the expected answer?"). Model: `provider:model` from `scorerConfig.llmJudge.judge`, `--judge`, `defaults.judge`, or `BEHAVTEST_JUDGE`. |
| `latencyCost` | Records latency and **fails** if `maxLatencyMs` or `maxCostUsd` is exceeded. With no thresholds it always passes. If `maxCostUsd` is set but the cost is unknown it reports an error, not a silent pass. |
| `toolCalled` | Checks the pipeline's [trace](#traces-check-what-the-agent-did-not-just-what-it-said): was a tool called (with these arguments, this many times), or not called. |
| `maxSteps` | Checks the trace: did the attempt finish within a step budget (optionally of one kind)? |
| `retrieval` | [RAG](#rag-test-retrieval-and-grounded-answers): were the case's `expectedDocs` retrieved? `hit`, `recall`, `precision` or `mrr` at `k`. Deterministic. |
| `faithfulness` | RAG, LLM judge: is the answer supported by the retrieved documents? One verdict, or claim by claim. |
| `contextRelevance` | RAG, LLM judge: were the retrieved documents relevant to the question? |
| *your own* | Any function in a [code suite](#code-suites-typescript-or-javascript), or a scorer registered through the [library](#library-api-and-custom-scorers). |

### The LLM judge

Judge scores are useful, but **they are not ground truth**. Studies find raw judge agreement overstates real accuracy, and judges can be talked into passing bad answers. BehavTest takes these precautions:

- **Prompt-injection resistant.** The pipeline output is untrusted text. It is fenced inside a per-call random delimiter, and the judge is told everything inside is data, never instructions.
- **Structured verdicts.** The judge must return schema-validated JSON (`{reasoning, verdict}`, reasoning first) using the provider's native structured output, at temperature 0. Models that accept only their default temperature (such as current OpenAI reasoning models) reject that; BehavTest then asks again without it, so those judges run at their default temperature, and it warns you, because their verdicts can vary more between runs.
- **Checked before the run.** Before any case runs, BehavTest asks each judge one trivial question. If the judge cannot answer with a valid verdict (unknown model, bad key, no structured output), the run stops with exit 2 and says why, instead of erroring every attempt. It costs one tiny call per judge; `--no-judge-check` skips it.
- **Fail closed.** A malformed, refused or failed judge response makes the attempt **errored**, never an implicit pass.
- **Recorded.** Judge spend is recorded separately from pipeline cost, and every verdict records which judge model produced it and at what temperature (`behavtest show` and the HTML report display it).
- **Self-preference warning.** BehavTest warns when the judge model is the same as the pipeline model (judges favour their own output).
- **Changing the judge is a change, not a regression.** The judge model is part of each judged case's identity, so `behavtest compare` reports those cases as `modified` when two runs used different judges.

**Choosing a judge model.** Pick by measured cost per verdict, not list price: reasoning models can spend hundreds of hidden tokens on one verdict. In a small test (2026-09-23, two to four verdicts per model), `gpt-5-nano` (the lowest list price) used 376 to 888 output tokens per verdict, mostly hidden reasoning, and cost 5 to 12 times as much per verdict as `gpt-4.1-nano` or `gpt-6-luna`, which used 40 to 60.

It is still a single LLM making a judgment. Use an exact or programmatic check where you can, treat judge results as one signal, and [measure how often the judge agrees with you](#judge-calibration-does-the-judge-agree-with-you) before relying on it.

## Code suites: TypeScript or JavaScript

JSON is great for data. When you want to call your agent directly, or score with your own logic, write the suite in code:

```bash
behavtest init --ts          # writes behavtest/suite.mts: no server, no API key
behavtest run behavtest/suite.mts
```

```ts
// support-bot.suite.ts
import type { CodeSuite } from "behavtest";
import { answer } from "./agent.ts";        // your real agent; write the .ts extension in local imports

export default {
  name: "support-bot",
  defaults: { repeat: 3 },
  // Test a function in your own process. (Or keep { adapter: "http", config: { url } }.)
  pipeline: {
    name: "support-agent",
    config: { model: "claude-sonnet-5", promptVersion: "v7" },   // recorded with each run (secrets are masked)
    run: async (input) => {
      const r = await answer(String(input));
      return { output: r.text, costUsd: r.costUsd, usage: r.usage };  // or just return a string
    },
  },
  scorers: {
    // A custom scorer is just a function. Return a boolean, or { pass, value, reasoning }.
    citesPolicy: ({ output }) => /policy #\d+/i.test(output),
    underBudget: ({ meta }) => ({ pass: (meta.costUsd ?? 0) < 0.01, value: meta.costUsd, reasoning: `$${meta.costUsd}` }),
  },
  cases: [
    { id: "refund-window", input: "How long do I have to return an item?", scorers: ["citesPolicy", "underBudget"] },
  ],
} satisfies CodeSuite;
```

- **What is allowed:** everything a JSON suite has, plus `scorers` (name → function) and a `pipeline` with a `run` function. Built-in scorers sit alongside yours. A scorer may also be an object `{ score, requiresExpected?, preflight?, fingerprint? }`. `export default` may be an (async) function that returns the suite.
- **TypeScript without tooling:** Node imports `.ts` / `.mts` files natively by stripping types: no loader, no build step, no extra dependency. That means type syntax only (no `enum`, `namespace` or parameter properties), and local imports must include the `.ts` extension. `import type { CodeSuite } from "behavtest"` is erased, so `npx behavtest` works without installing anything in your project (a *value* import such as `defineSuite` or `tracer` needs `npm i -D behavtest`). Prefer plain JavaScript? A `.mjs` suite has the same shape.
- **File extension and module type:** suites are ES modules. A plain `.ts` (or `.js`) file is treated as an ES module only if your `package.json` says `"type": "module"`; `npm init` writes `"type": "commonjs"`, in which case use **`.mts`** / **`.mjs`** (what `behavtest init --ts` does, so it works in any project), and give local helper files the same treatment. BehavTest tells you when this is the problem.
- **Timeouts are enforced for you.** Every attempt and every scorer is bounded by `--timeout` (default 30 s), even if your code ignores the `AbortSignal` it is given; a hung function becomes an *errored* attempt, not a hung run.
- **Editing a scorer is a change, not a regression.** Each inline scorer is fingerprinted from its source, and the fingerprint is part of its cases' identity, so after you edit one, `behavtest compare` reports those cases as `modified` instead of comparing results produced by different logic. (Changes in code the scorer *imports* are not detected: bump `fingerprint` if you keep logic in a helper.)
- **Suite files run code.** Loading a code suite executes it, exactly like a test file: only run suites you trust. JSON suites are pure data.

## Traces: check what the agent did, not just what it said

An agent can give the right answer for the wrong reason, or the same answer after twice as many steps. If your pipeline reports its **steps** (LLM calls, tool calls, retrievals), BehavTest stores them with each attempt, shows them, and can score them.

**From an HTTP pipeline**, add `steps` to the response:

```json
{
  "output": "Your order shipped on Monday.",
  "steps": [
    { "kind": "agent", "name": "order-agent", "startOffsetMs": 0, "durationMs": 78, "children": [
      { "kind": "retrieval", "name": "search", "durationMs": 9, "input": { "query": "order 123" } },
      { "kind": "tool", "name": "lookup_order", "durationMs": 25, "input": { "orderId": 123 }, "output": { "status": "shipped" } },
      { "kind": "llm", "name": "answer", "durationMs": 40 }
    ] }
  ]
}
```

`kind` is one of `llm`, `tool`, `retrieval`, `agent`, `other`; everything except `kind` and `name` is optional.

**From a function pipeline**, record steps with `tracer()`. Steps started inside another step become its children, and errors are recorded on the step:

```ts
import { tracer } from "behavtest";   // a value import: npm i -D behavtest

async function run(question: string) {
  const t = tracer();
  const docs = await t.step("retrieval", "search", () => search(question), { input: { query: question } });
  const order = await t.step("tool", "lookup_order", () => lookupOrder(123), { input: { orderId: 123 } });
  const text = await t.step("llm", "answer", () => answer(question, docs, order));
  return { output: text, steps: t.steps };
}
```

**Score the trace** with two built-in scorers (a case using them errors, never passes, when the pipeline reported no trace):

| Scorer | Config | Passes when |
|---|---|---|
| `toolCalled` | `tool`; optional `argsInclude` (the call's `input` contains these values; objects match partially), `times` (exact count), `not` | the tool was called (with those arguments, that many times), or with `not: true`, was not |
| `maxSteps` | `max`; optional `kind` | the attempt took at most `max` steps (of that kind): catches loops and runaway retries |

```json
"scorers": ["llmJudge", "toolCalled", "maxSteps"],
"scorerConfig": {
  "toolCalled": { "tool": "lookup_order", "argsInclude": { "orderId": 123 } },
  "maxSteps": { "max": 5, "kind": "retrieval" }
}
```

Your own scorers receive the full trace as `trace` in their arguments.

**See it:** `behavtest show <run> <case>` prints the step tree with durations (`--full` adds each step's input and output), and the HTML report has a collapsible trace with timing bars under each attempt. Run files include traces, except compact ones.

**What is stored.** Values under secret-looking keys (`authorization`, `api_key`, `token`, `password`...) are masked, step inputs and outputs longer than 20,000 characters are clipped, and at most 1,000 steps are kept per attempt; anything cut is marked. `behavtest run --no-trace` stores none; scorers still see them.

## RAG: test retrieval and grounded answers

A retrieval-augmented pipeline can fail in two places: it retrieves the wrong documents, or it answers with something the documents do not say. BehavTest scores both, from the documents the pipeline reports in its trace.

**Report what was retrieved** as a `retrieval` step. Its `output` is a list of documents: `{ "id": "refunds", "text": "..." }`, plain strings (text only), or LangChain documents (`{ pageContent, metadata: { id | source } }`). Several retrieval steps are read in order, each id once:

```json
{
  "output": "A refund is issued within 5 business days.",
  "steps": [
    { "kind": "retrieval", "name": "search", "output": [
      { "id": "refunds", "text": "Refunds go back to the original payment method. A refund is issued within 5 business days...", "score": 6.2 },
      { "id": "gift-cards", "text": "Gift cards never expire...", "score": 1.6 }
    ] },
    { "kind": "llm", "name": "answer" }
  ]
}
```

| Scorer | Config | Value / passes when |
|---|---|---|
| `retrieval` | `metric`: `hit` (default), `recall`, `precision`, `mrr`; optional `k`, `min` (default 1; required for `precision`) | the metric at `k` for the case's `expectedDocs`, at least `min`. Deterministic: no model |
| `faithfulness` | `mode`: `answer` (default) or `claims`; `min` (claims, default 1); `judge` | answer: every statement is supported by the retrieved text (1/0). claims: the supported fraction of the answer's claims, all checked in the **same single judge call** |
| `contextRelevance` | `min` (default: at least one relevant document); `judge` | the fraction of retrieved documents the judge rates relevant to the question |

- **Errors, never passes,** when there is nothing to compare: no retrieval step, no `expectedDocs` (for `retrieval`), or documents without ids (`retrieval`) or text (the judge scorers).
- **Retrieved documents are untrusted input.** A poisoned document can carry prompt injection, so the judge sees documents fenced like the answer and is told never to follow them. Long documents are clipped (4,000 characters each, 24,000 in total).
- **Judge choice, measured.** On the example pipeline (2026-09-28: 36 answers per judge and mode with known right verdicts, 12 of them with an invented claim), `gpt-4.1-mini` and `gpt-5.4-nano` were right every time in both modes; `gpt-4.1-nano` was right 36/36 in answer mode and 34/36 in claims mode (one wrong verdict, one timeout). With a retrieved document that told the judge to pass everything, `gpt-5.4-nano` and `gpt-6-luna` still failed the invented claim every time, but `gpt-4.1-nano` was fooled once in two claims-mode attempts (it cited the injected document as the source). Prefer a capable judge, check the sources in the reasoning, and measure your own data with `behavtest calibrate`.
- `faithfulness` and `contextRelevance` share the [judge's](#the-llm-judge) safeguards: structured output, fail-closed, the pre-run check, and the recorded judge model and temperature.
- **Try it:** [`examples/rag`](https://github.com/dhrumilbhut/behavtest/tree/main/examples/rag) has a store-policy RAG pipeline with `healthy`, `degraded` (retrieval breaks) and `hallucinate` (adds an unsupported claim) modes, and a suite for it: `node examples/rag/server.mjs`, then `behavtest run examples/rag/suite.json`.

## Judge calibration: does the judge agree with you?

An LLM judge's pass rate is only as good as the judge. `behavtest calibrate` compares its verdicts with your own labels on the same answers.

1. **Label.** Run `behavtest serve` and open a run: every judge verdict has **Your label: Pass / Fail** buttons, and each click is saved to the results database. Or, without a server, use the same buttons in an HTML report (`behavtest report <run> --out report.html`), where labels stay in your browser until you **Export labels** to `behavtest-labels-<run>.jsonl`. You can also write that file yourself: one `{ "run": "<id or prefix>", "case": "<id>", "attempt": 1, "scorer": "llmJudge", "label": "pass" | "fail" }` per line (`attempt` defaults to 1, `scorer` to `llmJudge`).
2. **Measure.** `behavtest calibrate` reads the labels saved in the database; `--labels <file>` reads a file instead. For example, with 40 labels on one rubric:

```bash
behavtest calibrate
```

```
behavtest calibrate · 40 labels, 40 matched

  llmJudge · judge openai:gpt-4.1-nano · "Cites the policy?"
    labels 40   agreement 90% [77%–96%]   kappa 0.80 [0.59, 0.95]  (almost perfect agreement)
    judge passed 2 of 20 answers you failed (false pass 10%) · failed 2 of 20 you passed (false fail 10%)
                 you: pass  you: fail
    judge pass          18          2
    judge fail           2         18
```

- **Per scorer, judge model and rubric:** a judge is calibrated for one rubric, not in general.
- **Cohen's kappa** is agreement beyond chance (1 = perfect, 0 = chance); the interval is a bootstrap. The **false-pass rate** is how often the judge lets through an answer you would fail.
- **Gate:** `--min-kappa 0.6` exits 1 unless every group has at least 30 labels and kappa at or above 0.6. Fewer than 30 labels is reported as too few, never as a pass.
- Labels that match no stored verdict, labels on verdicts where the judge errored, and duplicates (the last one counts) are reported. `--json`, `--md`.
- The dashboard's **Calibration** page shows the same numbers live, and lists the verdicts where the judge disagreed with you, each linked to the answer.

## Non-determinism: repeat your cases

```bash
behavtest run suite.json --repeat 5
```

Each case runs 5 times as separate attempts. A case where every attempt passes is **passed**, none **failed**, and a mix is **flaky**, which exits non-zero. One green run of a stochastic pipeline proves little; repeated attempts show you the real pass rate. Every attempt is stored, and [`behavtest compare`](#compare-runs-what-regressed-and-is-it-real) uses them to tell a real regression from noise.

`--min-pass-rate 0.9` replaces "every case must pass" with "at least 90% of attempts must pass" (errored attempts count as not passed), for suites where some flakiness is acceptable. Then use `compare` to catch it getting worse.

## Compare runs: what regressed, and is it real?

```bash
behavtest run suite.json --repeat 5 --label prompt-v6     # before your change
# ...edit the prompt / swap the model...
behavtest run suite.json --repeat 5 --label prompt-v7     # after
behavtest compare                                         # latest run vs the one before it
```

```
behavtest compare · support-bot
  base  f033e1c8  2026-09-21 14:53  prompt-v6
  head  22ec5145  2026-09-21 14:53  prompt-v7

  ✗ regressed author-of-hamlet    5/5 → 0/5   100% → 0%  p=0.008 significant
  ✗ regressed symbol-for-gold     5/5 → 2/5   100% → 40%  p=0.167
      not statistically significant at this sample size
  ✓ improved  is-pluto-a-planet   0/5 → 5/5   0% → 100%  p=0.008 significant
  ~ flaky     largest-ocean       3/5 → 3/5   60% → 60%
  6 unchanged cases hidden (use --all to list them)

  attempt pass rate  88% [78%–94%] → 67% [54%–77%]  (12 comparable cases; descriptive)
  overall change     mean per case -21.7 pts, 95% CI [-28.3 pts, -15.0 pts], p=0.0015 → significant regression
```

`behavtest compare` takes `[base] [head]`: run ids (unique prefixes work) or [run files](#baselines-and-ci-fail-the-pull-request-that-made-things-worse). With one run id it compares that run with the run before it; with one run file, that file (as the baseline) with the latest run of its suite; with none, the latest two. Add `--fail-on-regression` to make it a CI gate (exit 1), `--json` / `--md` to write the result, and `--all` to list unchanged cases. `behavtest report <run> --against <base> --out report.html` writes the same comparison as a [single-file HTML report](#reports).

**How it decides.** Model outputs are random, so one run each is rarely enough to call a regression. BehavTest is explicit about what it knows:

- **Per case** it compares pass rates with Wilson 95% intervals, and runs Fisher's exact test. A change is *significant* only when p < 0.05. That takes several attempts per case: with 3 attempts per side even 3/3 → 0/3 is p = 0.1. Changes on a single attempt are still listed, flagged "could be noise, re-run with `--repeat`".
- **Overall** it runs a paired permutation test, stratified by case, on the mean change in pass rate, with a within-case bootstrap for the interval. The question a gate asks is "on *this* suite, did the pass rate move by more than the pipeline's sampling noise?", so the randomness that matters is *within* each case, not which cases happen to exist. With one attempt per case this reduces to an exact sign test on the cases that flipped: six one-way flips are significant (p = 0.031), five are not (p = 0.063).
- **Never compared:** a case whose definition changed between the runs (`modified`, which includes a different judge model for judged cases), a case in only one run (`new` / `removed`), and a case with an errored attempt (`errored`: no verdict). They are listed, never counted as regressions.

`--fail-on-regression` fails on any regressed case (significant or not, because single-attempt suites can't do better), on any case that errored in the head run, and on a significant overall drop. `--significant-only` ignores regressions that aren't statistically significant. The tests check the statistics against textbook reference values and, by simulation, that the overall test rejects under 9% of the time when nothing changed and over 95% of the time for a real drop.

## Matrix runs: compare models and prompts side by side

A matrix runs the same cases through several pipeline setups, a model, a prompt version or a temperature, and compares them with the same statistics as `compare`. Add `variants` to a suite:

```json
{
  "name": "model-shootout",
  "pipeline": { "adapter": "openai", "config": { "model": "gpt-4.1-nano", "system": "Answer with only the final answer." } },
  "variants": [
    { "name": "gpt-4.1-nano" },
    { "name": "gpt-4o-mini", "pipeline": { "config": { "model": "gpt-4o-mini" } } },
    { "name": "gpt-5.4-nano", "pipeline": { "config": { "model": "gpt-5.4-nano" } } },
    { "name": "gpt-6-luna", "pipeline": { "config": { "model": "gpt-6-luna" } } }
  ],
  "defaults": { "repeat": 3 },
  "cases": [ ... ]
}
```

`behavtest run` prints how many calls the matrix will make, then runs each variant as an ordinary run (labelled with the variant) and prints the comparison. This is [`examples/matrix/suite.json`](examples/matrix/suite.json), run for real (12 questions × 3 attempts × 4 models, about $0.002):

```
behavtest matrix · model-shootout · 4 variants · matrix b4812ebe

  variant         pipeline             attempt pass rate [95% CI]  cases passed  flaky  p95 latency     cost  vs gpt-4.1-nano
  gpt-4.1-nano *  openai:gpt-4.1-nano  92% [78%–97%]                      11/12      0     2,382 ms  $0.0002  reference
  gpt-4o-mini     openai:gpt-4o-mini   100% [90%–100%]                    12/12      0     2,877 ms  $0.0003  +8.3 pts [+8.3 pts, +8.3 pts] p=0.101 not significant
  gpt-5.4-nano    openai:gpt-5.4-nano  89% [75%–96%]                      10/12      2     2,697 ms  $0.0005  -2.8 pts [-8.3 pts, +2.8 pts] p=1.000 not significant
  gpt-6-luna      openai:gpt-6-luna    100% [90%–100%]                    12/12      0     4,500 ms  $0.0008  +8.3 pts [+8.3 pts, +8.3 pts] p=0.106 not significant

  case                gpt-4.1-nano  gpt-4o-mini  gpt-5.4-nano  gpt-6-luna
  letters-strawberry         0/3 ✗        3/3 ✓         3/3 ✓       3/3 ✓
  bat-and-ball               3/3 ✓        3/3 ✓         1/3 ~       3/3 ✓
  decimal-compare            3/3 ✓        3/3 ✓         1/3 ~       3/3 ✓
  ...
```

Twelve questions cannot tell these models apart with confidence: every difference is "not significant". That is the point of the intervals. Add cases and attempts until the differences you care about are significant, or until you are confident they are small.

- **How variants combine:** a variant's `config` is merged over `pipeline.config` (nested objects merged, other values replaced); a variant with a different `adapter` replaces the config instead. In a code suite a variant's `pipeline` can be a function.
- **Same cases, same judge:** variants cannot change cases or the judge, so every variant is judged the same way and cases compare one to one. Case hashes do not include the pipeline, so nothing shows as `modified`.
- **`behavtest matrix [id]`** shows the latest matrix (or one by id prefix; `--list` lists them). `--reference <variant>` picks what the others are compared with (default: the first). `--md`, `--json`, and `--out report.html` (a single-file report with a dot-and-interval chart and the case grid). The dashboard has a **Matrix** page.
- **`--variant <name>`** (repeatable) runs only some variants. `behavtest compare` and the dashboard's trends compare a run with earlier runs of the same variant.
- **Cost:** a matrix multiplies calls (variants × cases × attempts); the count is printed before anything runs. Variants run one after another.

## GitHub Action

Block the pull request that makes your LLM app worse. The Action installs BehavTest, runs your suite, compares it with a committed baseline, writes the comparison to the job summary, uploads the HTML report, and fails the check according to `gate`. [See it on a demo repository](https://github.com/dhrumilbhut/behavtest-demo/pulls): one pull request passes, the other is blocked with the two cases it broke.

```yaml
name: BehavTest
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write   # only for comment: true

jobs:
  behavtest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      # Start your pipeline here if the suite calls it over HTTP.
      - uses: dhrumilbhut/behavtest@v0
        with:
          suite: behavtest/suite.json
          repeat: 3
          comment: true
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Create the baseline once from a run you accept, and commit it: `npx behavtest run behavtest/suite.json --repeat 3 --export behavtest.baseline.json --compact`. Without a baseline the Action still runs and its summary says how to make one.

| Input | Default | Meaning |
|---|---|---|
| `suite` | (required) | Suite file, relative to `working-directory` |
| `baseline` | `behavtest.baseline.json` | The committed baseline run file |
| `gate` | `regression` | `regression`: fail if any case regressed or errored, or the pass rate dropped significantly. `significant`: only significant regressions. `cases`: fail if any case failed, was flaky or errored in this run (with `min-pass-rate`, if too few attempts passed). `none`: never fail (configuration errors still do) |
| `repeat` | suite's | Attempts per case; use the same number as the baseline |
| `min-pass-rate` | | With `gate: cases`, the fraction of attempts that must pass |
| `judge` | suite's | LLM judge model, e.g. `openai:gpt-5.4-nano` |
| `args` | | Extra `behavtest run` arguments, e.g. `--tag smoke` |
| `comment` | `false` | Keep one pull request comment up to date with the result (needs `pull-requests: write`; skipped outside pull requests, a warning if refused) |
| `report` | `true` | Upload the HTML report, run file and summaries as an artifact |
| `working-directory`, `artifact-name`, `node-version`, `github-token` | | As named |

Outputs: `result` (`pass`, `fail` or `error`), `regressed` (number of regressed cases), `run-id`, `report-path`.

**Choosing a gate.** `regression` fails on any case whose pass rate dropped, which suits suites that are close to deterministic. If your pipeline is genuinely random, some cases will drop by chance on an unchanged branch: use `gate: significant` with enough attempts per case (5 or more) that a real drop can reach significance, or `gate: cases` with `min-pass-rate`. [LLM regression testing](https://dhrumilbhut.github.io/behavtest/llm-regression-testing/) shows the difference on real numbers.

The Action runs the BehavTest release that matches its tag (`@v0` follows the latest 0.x release; pin `@v0.8.0` for a fixed version). API keys come from your workflow's `env`, as for any step.

**Updating the baseline** is a reviewed change. A manual workflow that opens a pull request with a fresh baseline:

```yaml
name: Update BehavTest baseline
on: workflow_dispatch

permissions:
  contents: write
  pull-requests: write

jobs:
  baseline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npx behavtest@0.8 run behavtest/suite.json --repeat 3 --export behavtest.baseline.json --compact || test $? -eq 1
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      - env:
          GH_TOKEN: ${{ github.token }}
        run: |
          git switch -c behavtest-baseline-${{ github.run_id }}
          git -c user.name=github-actions -c user.email=github-actions@users.noreply.github.com commit -am "Update BehavTest baseline"
          git push -u origin HEAD
          gh pr create --fill --title "Update BehavTest baseline"
```

## Baselines and CI: fail the pull request that made things worse

`compare` needs a run to compare against, and a CI job starts with an empty `.behavtest/` directory. **Run files** fill that gap: a portable JSON copy of a run, with every attempt's case hash, so `compare` still tells a changed case from a regression.

```bash
behavtest run suite.json --repeat 3 --export run.json    # write a run file as part of a run
behavtest export <run> --out run.json                    # or export a saved run (no --out: print it)
behavtest compare base.json head.json                    # compare two files: no database needed
behavtest compare behavtest.baseline.json                  # a file alone is the base, vs the latest run of its suite
behavtest report <run> --against behavtest.baseline.json --out report.html
behavtest import run.json                                # load a full run file into the database
```

**Compact run files** (`--compact`) keep only what a comparison needs: case ids and hashes, attempt statuses, latency, cost and each scorer's pass/fail. They leave out inputs, expected answers, outputs, error messages, judge reasoning and traces, so they are small and safe to commit. They can be compared against, but not imported or turned into a report of their own.

(A `--json` report is not a run file: it has no case hashes, so it can't be used as a baseline.)

### Recipe 1: a committed baseline (recommended)

On GitHub, the [GitHub Action](#github-action) does this recipe for you. The steps below do the same with the CLI, for other CI systems or more control.

Keep `behavtest.baseline.json` in the repository. Every pull request compares against it, and moving the baseline is an ordinary, reviewed commit, so the git history doubles as the history of your pipeline's quality.

Create or update the baseline when the pipeline is in a state you accept:

```bash
behavtest run behavtest/suite.json --repeat 3 --export behavtest.baseline.json --compact
git add behavtest.baseline.json && git commit -m "Update BehavTest baseline"
```

Then gate pull requests (`.github/workflows/behavtest.yml`):

```yaml
name: BehavTest
on: pull_request

jobs:
  behavtest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      # Start your pipeline here if the suite calls it over HTTP.
      - name: Run the suite
        # Exit 1 (some cases failed) is fine here: the comparison decides. Exit 2 (bad config) still fails.
        run: npx behavtest@0.8 run behavtest/suite.json --repeat 3 || test $? -eq 1
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      - name: Compare with the baseline
        run: npx behavtest@0.8 compare behavtest.baseline.json --fail-on-regression --md behavtest.md
      - name: Job summary
        if: always()
        run: cat behavtest.md >> "$GITHUB_STEP_SUMMARY"
```

Use the same `--repeat` for the baseline and the pull request runs: more attempts per case give the comparison more power (see [how it decides](#compare-runs-what-regressed-and-is-it-real)). If the pull request deliberately changes cases, they show as `modified` and don't fail the gate; update the baseline in the same pull request.

### Recipe 2: the latest run on main as the baseline

No committed file: every push to `main` uploads its run, and pull requests compare against the newest one. Less ceremony, but the baseline moves without review.

```yaml
name: BehavTest
on:
  push:
    branches: [main]
  pull_request:

jobs:
  behavtest:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read   # to download main's run
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - name: Run the suite
        run: npx behavtest@0.8 run behavtest/suite.json --repeat 3 --export run.json --compact || test $? -eq 1
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      - name: Keep main's run as the baseline
        if: github.event_name == 'push'
        uses: actions/upload-artifact@v7
        with:
          name: behavtest-baseline
          path: run.json
      - name: Compare with main
        if: github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          id=$(gh run list --workflow behavtest.yml --branch main --event push --status success --limit 1 --json databaseId --jq '.[0].databaseId')
          gh run download "$id" --name behavtest-baseline --dir baseline
          npx behavtest@0.8 compare baseline/run.json run.json --fail-on-regression --md behavtest.md
          cat behavtest.md >> "$GITHUB_STEP_SUMMARY"
```

## Reports

A [live example](https://dhrumilbhut.github.io/behavtest/sample/) is published from the deterministic sample (`npm run sample-report`).

- **HTML:** `behavtest report <run> [--against <base>] --out report.html` writes one self-contained file: no network access, no external assets, opens from `file://`, light and dark themes, filter and search, and per-case drill-down with inputs, outputs, scores, judge reasoning and traces. Pipeline outputs are untrusted text and are only ever inserted as text, never HTML.
- **Markdown:** `behavtest run --md summary.md` and `behavtest compare --md compare.md` write GitHub-flavoured summaries, ready for a CI job summary (`cat summary.md >> "$GITHUB_STEP_SUMMARY"`) or a PR comment.
- **JSON:** `--json` on `run` and `compare`, for scripts and dashboards.
- **Console:** `behavtest runs` lists saved runs; `behavtest show <run> [case]` prints a run, or one case's input, outputs, scores and trace.

## Dashboard: browse, compare and label runs

```bash
behavtest serve                  # http://127.0.0.1:4800/
behavtest serve --open --port 5000 --db path/to/results.db
```

A local web dashboard on your results database, for looking around rather than gating CI. Runs still start from the CLI or CI; the dashboard reads what they saved.

- **Runs:** every run with its outcome, label, git commit, cases passed, attempt pass rate, flaky cases and cost, filterable by suite, and a **pass-rate trend** per suite (each run's attempt pass rate with its 95% interval; hover or use the arrow keys for details, click to open a run).
- **Run:** the same drill-down as the HTML report: summary, each case's input, attempts, outputs, scores, judge reasoning and traces (loaded when you open a case).
- **Compare:** pick any two runs for the full comparison: what regressed, improved or is flaky, with the significance tests from [`behavtest compare`](#compare-runs-what-regressed-and-is-it-real).
- **Labels and calibration:** mark judged answers Pass or Fail; labels are saved to the database as you click, `behavtest calibrate` reads them, and the **Calibration** page shows each judge's agreement, kappa, confusion matrix and the answers where it disagreed with you.

It is one plain page with no external assets, in light and dark themes, served by Node's own HTTP server (no extra dependencies). The only thing it writes is your labels. Its JSON API (`/api/v1/runs`, `/api/v1/runs/<id>`, `/api/v1/compare?base=&head=`, `/api/v1/trend?suite=`, `/api/v1/calibration`, `/api/v1/labels`) is available to scripts on the same machine.

**Security:** it listens on `127.0.0.1` only by default. It refuses requests whose `Host` is not `localhost`, an IP address or the host you started it with (so a web page cannot reach it through DNS rebinding), refuses label changes sent from other sites, and serves a strict Content-Security-Policy. There is no login: `--host 0.0.0.0` makes your runs (inputs, outputs, traces) readable by anyone who can reach the port, and BehavTest prints a warning when you do it.

## Exit codes and storage

| Exit code | Meaning |
|---|---|
| `0` | every case passed (or `--min-pass-rate` was met) |
| `1` | at least one case failed, was flaky, or **errored** (a broken pipeline is never green); for `compare --fail-on-regression`, the gate failed |
| `2` | usage or configuration error; nothing was run (invalid suite, missing env var, bad flag, a judge that does not work) |
| `130` | interrupted (Ctrl+C); attempts finished so far are saved and the run is marked `interrupted` |

- **Errored vs failed:** *failed* means the pipeline answered and a scorer said no. *Errored* means BehavTest couldn't get a verdict (pipeline down, timeout, judge unavailable). The console and the JSON report keep them apart.
- **Where results are stored:** one SQLite file, `.behavtest/results.db` (or `--db <path>`), with tables `runs`, `results` (one row per attempt, with snapshots of the input and expected values), `scores`, `traces` and `labels` (your pass/fail labels on judge verdicts). Runs are written incrementally, so a crash keeps what completed, and older databases upgrade automatically.
- Nothing is written anywhere else unless you ask for a file (`--json`, `--md`, `--export`, `report --out`).

## Cost

Cost is computed from the provider's reported token usage, priced **per category**: regular input, cache reads, cache writes (5-minute and 1-hour), and output. If a model has no known price, or usage is missing, the cost is **unknown** (shown as such), never guessed.

Prices ship in [`src/pricing/prices.json`](https://github.com/dhrumilbhut/behavtest/blob/main/src/pricing/prices.json) (dated 2026-09-23): current Anthropic models, and OpenAI's GPT-6, GPT-5.x, GPT-4.1, GPT-4o and o4-mini families. Where OpenAI shows no cache-read or cache-write price for a model, a call that uses one has unknown cost. Things to know:

- **Short-context prices only.** OpenAI also charges higher per-token prices above a context-size threshold; that tier is *not* modelled, so requests in it are under-priced. Supply an override if you use it.
- **Promotions expire.** `gpt-5.6-sol` is priced at its promotional rate through 2026-11-21 and at the standard rate afterwards (`validUntil` on the entry). If a promotion is extended, BehavTest will over-report cost until you override it.
- **OpenAI cache writes** (`prompt_tokens_details.cache_write_tokens`, GPT-5.6+) are priced at the cache-write rate and treated as a subset of `prompt_tokens`, per OpenAI's usage format. OpenAI publishes no official cost formula from those fields, so treat OpenAI cost as an estimate.

Add or override prices in the suite:

```json
"pricing": [{ "provider": "openai", "model": "my-model", "inputPerMTok": 2.5, "outputPerMTok": 10, "cachedInputPerMTok": 1.25, "validUntil": "2027-01-31" }]
```

or with `--prices prices.json` (an array or `{entries: [...]}`; `validUntil` is optional). Check the provider's pricing page: BehavTest's table is a convenience, not a bill.

## CLI reference

```
behavtest run <suite> [options]     Run a suite (.json, or a code suite: .ts .mts .js .mjs), score outputs, save the run
  --db <path>                     SQLite file (default .behavtest/results.db)
  --json <file>                   also write a JSON report
  --md <file>                     also write a Markdown summary
  --export <file> [--compact]     also write a run file (--compact: only what a comparison needs)
  --min-pass-rate <0-1>           pass if at least this fraction of attempts pass
  --concurrency <n>               attempts in flight (default 4)
  --repeat <n>                    attempts per case (overrides the suite)
  --timeout <ms>                  per-attempt timeout (default 30000)
  --tag <tag>                     only cases with this tag (repeatable)
  --case <id>                     only this case (repeatable)
  --label <text>                  label the run (e.g. a prompt version)
  --variant <name>                matrix suites: only this variant (repeatable)
  --judge <provider:model>        LLM judge model
  --no-judge-check                skip the one tiny call that checks the judge before any case runs
  --no-trace                      do not store the steps pipelines report
  --prices <file>                 extra/override model prices
  --no-color                      plain output (also honours NO_COLOR; set BEHAVTEST_ASCII=1 for ASCII symbols)
behavtest runs [--suite <name>] [--limit <n>]        List saved runs, newest first
behavtest show <run> [case] [--full]                 A run's summary, or one case's input, outputs, scores and trace
behavtest compare [base] [head] [options]            What regressed, improved, or is just flaky; runs are ids or run files
  --fail-on-regression | --significant-only        exit 1 when the gate fails
  --all  --json <file>  --md <file>  --suite <name>
behavtest report <run> [--against <base>] [--out <file>]   Single-file HTML report (runs are ids or run files)
behavtest export <run> [--out <file>] [--compact]    Write a run file (a baseline to commit, or to compare or import elsewhere)
behavtest import <file>                              Load a full run file into the database
behavtest calibrate [--labels <file>] [--min-kappa <k>] [--json <file>] [--md <file>]   How often the judge agrees with your labels
                                                   (default: the labels saved from the dashboard)
behavtest serve [--port <n>] [--host <host>] [--open] Local dashboard: runs, trends, compare, matrices, labels, calibration
behavtest matrix [id] [--reference <v>] [--list] [--md|--json|--out <file>]   Variants of a matrix side by side
behavtest init [--dir <dir>] [--force] [--ts]        Scaffold an example suite (--ts: a code suite, no server needed)
behavtest schema [--out <file>]                      Print the suite JSON Schema
```

Environment variables: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `BEHAVTEST_JUDGE` (default judge), `NO_COLOR`, `BEHAVTEST_ASCII`, plus any `${VAR}` your suite references.

## Library API and custom scorers

The easy way to add a scorer is an inline scorer in a [code suite](#code-suites-typescript-or-javascript). To reuse scorers across projects, or to run BehavTest from your own program, register them on a registry and call the library:

```ts
import { createRegistry, loadSuite, runSuite, SqliteStore } from "behavtest";

const registry = createRegistry().registerScorer({
  name: "mentionsParis",
  async score({ output }) {
    const pass = /paris/i.test(output);
    return { pass, value: pass ? 1 : 0, reasoning: pass ? undefined : "never mentions Paris" };
  },
});

const suite = loadSuite("suite.json", registry); // suites can now list "mentionsParis"
const store = new SqliteStore(".behavtest/results.db");
const outcome = await runSuite({ suite, registry, store, behavtestVersion: "custom" });
process.exitCode = outcome.exitCode;
```

`score` receives `{ input, expected, output, config, meta: { latencyMs, costUsd, usage, ... }, trace, runtime }` and returns `{ pass, value, reasoning?, costUsd?, error?, metadata? }`. Return `error` (rather than `pass: false`) when you *couldn't* evaluate, so the attempt is recorded as errored. Custom adapters work the same way through `registerAdapter`. The adapter and scorer interfaces are the library's stable contracts and change only additively.

Other exports include `calibrate`, `cohensKappa`, `retrievedDocs`, `compareRuns`, `regressionGate`, `renderHtmlReport`, `renderRunMarkdown`, `renderCompareMarkdown`, `buildRunFile`, `readRunFile`, `tracer`, `defineSuite` and the statistics helpers (`wilsonInterval`, `fisherExact`, `stratifiedPermutationTest`). Type definitions ship with the package.

## Troubleshooting

The messages below are quoted from BehavTest (without the backticks some of them contain); `…` stands for the part that names your file, case or variable.

**`… is not set. The openai adapter reads its API key from the environment.`**
Export the key in the shell or CI job that runs BehavTest (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or the variable named by `apiKeyEnv`). Keys are never read from the suite file.

**`Missing environment variable referenced in pipeline.config: …`**
The suite uses `${VAR}` and `VAR` is empty or unset. Set it, or give a default: `${PIPELINE_URL:-http://localhost:4000/pipeline}`.

**`case "…" uses llmJudge but no judge model is configured.`**
Judged scorers need a model: set `"defaults": { "judge": "openai:gpt-4.1-nano" }` in the suite, pass `--judge provider:model`, or export `BEHAVTEST_JUDGE`.

**`The judge … does not work: …`**
Before any case runs, BehavTest makes one tiny call to each judge. The message after the colon is the provider's answer: usually a wrong model name, a missing key, or a model without structured output. Fix the judge, or skip the check with `--no-judge-check`.

**`Failed to load suite module …: … Node is treating this file as CommonJS …`**
A `.ts` or `.js` suite is an ES module only when `package.json` says `"type": "module"`. Rename the suite to `.mts` / `.mjs` (what `behavtest init --ts` does), or set `"type": "module"`. Local files it imports need the same treatment.

**`Failed to load suite module …: … If it imports another TypeScript file, write the extension in the import …`**
Node's type stripping needs the extension in local imports (`import { answer } from "./agent.ts"`). If the suite imports values such as `tracer` or `defineSuite` from `behavtest`, install it in the project (`npm i -D behavtest`); `import type` needs no install.

**`Cannot load …: this Node.js (…) cannot import TypeScript files.`**
BehavTest needs Node.js 24 or newer. Upgrade Node, or write the suite as `.mjs` or `.json`.

**`No results database at "…". Run behavtest run <suite> first, or pass --db <path>.`**
`runs`, `show`, `compare`, `report`, `matrix`, `calibrate` and `serve` read the database a previous `run` wrote in the current directory. Run from the same directory, or point `--db` at it. In CI, compare against a committed run file instead: `behavtest compare behavtest.baseline.json`.

**`There is no earlier run of "…" to compare run … against.`**
`compare` without arguments needs two runs of the same suite (and the same variant). Run the suite again, or name both runs or files: `behavtest compare <base> <head>`.

**`… is not a BehavTest run file (expected "kind": "behavtest.run").`**
`compare` and `report --against` take run ids or run files written by `--export` or `behavtest export`. A `--json` report is not a run file: it has no case hashes. (Run files written by Regrade are still read.)

**Every run exits 1, but nothing looks broken.**
Exit 1 means at least one case failed, was flaky or errored. With a nondeterministic pipeline, flaky cases are expected: gate on the change instead (`behavtest compare … --fail-on-regression --significant-only`), or accept a pass rate (`--min-pass-rate 0.9`). See [deal with flaky, non-deterministic outputs](#deal-with-flaky-non-deterministic-outputs).

**Cases show as `modified` instead of regressed or improved.**
The case's definition, its scorer code or its judge model changed between the two runs, so their results aren't comparable. This is intended: update the baseline in the same change.

**Attempts are `errored` with `network error calling …` or `HTTP 5xx from …`.**
The pipeline could not answer, which is different from answering wrongly. Network errors, HTTP 429 and 5xx are retried (honoring `Retry-After`); raise `retries` in `pipeline.config`, check the service, or lower `--concurrency` if it is rate-limiting you.

**`Using .regrade/results.db (from Regrade, BehavTest's former name).`**
Not an error: results from before the rename are still used. Rename the `.regrade` folder to `.behavtest` to make the notice go away.

**`Port 4800 is in use. Pick another with --port <n>.`**
Another program (or another `behavtest serve`) is using the port: `behavtest serve --port 5000`.

Still stuck? [Open an issue](https://github.com/dhrumilbhut/behavtest/issues) with the command, the full message and `behavtest --version`.

## Migrating from Regrade

BehavTest is the new name of Regrade, from version 0.8.0. It is the same tool: the commands, options, suite format, scorers and statistics are unchanged, and results, baselines and settings you already have keep working.

| Regrade | BehavTest |
|---|---|
| `npm install regrade`, `npx regrade` | `npm install behavtest`, `npx behavtest` |
| `regrade <command>` | `behavtest <command>` (same commands and options) |
| `uses: dhrumilbhut/regrade@v0` | `uses: dhrumilbhut/behavtest@v0` |
| `import { ... } from "regrade"` | `import { ... } from "behavtest"` |
| `.regrade/results.db` | `.behavtest/results.db` |
| `regrade.baseline.json` | `behavtest.baseline.json` |
| `REGRADE_JUDGE`, `REGRADE_ASCII` | `BEHAVTEST_JUDGE`, `BEHAVTEST_ASCII` |
| `RegradeError`, `regradeVersion` (library) | `BehavTestError`, `behavtestVersion` |

What keeps working without changes:

- **Your results database.** Without a `.behavtest/` folder, an existing `.regrade/results.db` is used, with a one-line notice. Rename the folder to `.behavtest` to move it.
- **Your baselines.** Run files written by Regrade load as before. The Action uses `regrade.baseline.json` when there is no `behavtest.baseline.json`, and updates the pull request comment it posted before the rename instead of adding a second one.
- **Your environment.** `REGRADE_JUDGE` and `REGRADE_ASCII` are read when the `BEHAVTEST_` variables are not set.
- **Your code, mostly.** `RegradeError` is still exported, as a deprecated alias of `BehavTestError`. The one breaking change is for library users: the run's version field (`RunRecord.regradeVersion`, and the `regradeVersion` option of `runSuite` and `buildRunFile`) is now `behavtestVersion`.

The `regrade` package on npm stays published but deprecated, and gets no new releases.

## FAQ

**What is BehavTest?**
An open-source (MIT) CLI and Node.js library for behavioral regression testing of AI applications: LLM apps, AI agents and RAG pipelines. It runs test cases through your pipeline several times, scores the answers, stores every run, and tells you whether a change made results worse, with statistics that separate a real change in behavior from nondeterministic noise. It was called Regrade until version 0.8.0 (see [migrating from Regrade](#migrating-from-regrade)).

**Does it need an API key?**
No, not to start: `behavtest init --ts` and `behavtest init` run without one. You need a provider key only for the `openai` / `anthropic` adapters or for `llmJudge`.

**Does it work with Python, LangChain or LlamaIndex?**
Yes, through the HTTP adapter: expose one endpoint that takes `{ "input": ... }` and returns `{ "output": "..." }` ([example](#test-a-python-langchain-or-other-http-service)). BehavTest itself runs on Node.js 24+, which CI runners already have.

**Can I use local or self-hosted models (Ollama, vLLM)?**
Yes: use the `openai` adapter with `baseUrl` pointing at any OpenAI-compatible server, for the pipeline or for the judge (`OPENAI_BASE_URL`).

**Which LLM should I use as the judge?**
A different model from the one being tested, ideally one that accepts temperature 0, chosen by measured cost per verdict. `gpt-4.1-nano` is a cheap choice that worked well in our tests; see [the LLM judge](#the-llm-judge).

**How many repeats do I need?**
For a single case to show a *significant* drop, about 5 attempts per side (5/5 → 0/5 gives p = 0.008; 3/3 → 0/3 is only p = 0.1). Across many cases, fewer attempts can still show a significant overall drop. Start with `--repeat 3` and raise it for important suites.

**Where are my results stored, and does BehavTest send data anywhere?**
In `.behavtest/results.db` on your machine. BehavTest contacts only the pipeline and providers you configure. There is no telemetry and no update check.

**How do I run it in GitHub Actions or another CI system?**
On GitHub, use the [GitHub Action](#github-action) (`uses: dhrumilbhut/behavtest@v0`) with a committed baseline. In any other CI that runs Node.js, run `behavtest run … --export` and `behavtest compare behavtest.baseline.json --fail-on-regression` ([baselines and CI](#baselines-and-ci-fail-the-pull-request-that-made-things-worse)).

**Can I compare several models or prompts?**
Yes: add `variants` to a suite and `behavtest run` makes one run per variant; `behavtest matrix` shows them side by side with confidence intervals, cost and latency, and tests each against a reference ([matrix runs](#matrix-runs-compare-models-and-prompts-side-by-side)).

**How is BehavTest different from Promptfoo, DeepEval, Inspect AI or Ragas?**
Those are mature evaluation tools, several with broader feature sets or hosted options. BehavTest focuses narrowly on *behavioral regression testing*: repeated attempts per case, significance tests on the change between two runs, run files as CI baselines, and zero infrastructure, with no default provider. See [prior art](#prior-art).

**Is the LLM judge reliable?**
It is hardened (prompt-injection fencing, structured output, fail-closed, pre-run check), but it is still one model's opinion. Measure it: label some answers yourself and run `behavtest calibrate` for its agreement with you (Cohen's kappa). Prefer `exactMatch`, `toolCalled`, `retrieval` or your own programmatic scorers where possible, and repeat cases.

**How do I test a RAG pipeline?**
Report the retrieved documents as a `retrieval` trace step, list the right document ids per case in `expectedDocs`, and use `retrieval` (did it find them), `faithfulness` (is the answer grounded in them) and `contextRelevance` (was the context on topic). See [RAG](#rag-test-retrieval-and-grounded-answers) and `examples/rag`.

**Is there a UI?**
Yes, a local one: `behavtest serve` opens a dashboard on your results database (runs, pass-rate trends, comparisons, labelling and judge calibration), and `behavtest report` writes a single-file HTML report you can share. Neither needs an account or a hosted service.

**Is it free?**
Yes, MIT-licensed. You pay only your model providers for the calls your suites make.

## For AI coding assistants

If you are an AI assistant setting up BehavTest for a user, these facts are enough to do it correctly:

1. Requires Node.js 24+. Run it with `npx behavtest <command>`; `npm i -D behavtest` only if the suite imports values (`tracer`, `defineSuite`) from `"behavtest"`.
2. Scaffold with `npx behavtest init --ts` (code suite, no server, no key) or `npx behavtest init` (JSON suite plus mock HTTP pipeline). In a CommonJS project use `.mts` / `.mjs` for code suites.
3. A JSON suite needs `name`, `pipeline: { adapter, config }` (`http` | `openai` | `anthropic`) and `cases[]` with a stable `id`, an `input` and `scorers`. Add `"$schema": "https://unpkg.com/behavtest/schema/suite.schema.json"`. Unknown keys are errors.
4. Never put secrets in suite files: use `${ENV_VAR}` placeholders in `pipeline.config`. Keys come from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`.
5. `exactMatch` requires `expected`. `llmJudge` needs a judge (`defaults.judge: "provider:model"`), preferably not the pipeline's own model. `toolCalled` / `maxSteps` need the pipeline to return `steps`.
6. Use `--repeat 3` or more for LLM pipelines. Exit codes: 0 all passed, 1 failures/flaky/errored or gate failed, 2 configuration error, 130 interrupted.
7. To gate CI: create `behavtest.baseline.json` with `run --export behavtest.baseline.json --compact`, commit it, and in CI run `behavtest run … || test $? -eq 1` then `behavtest compare behavtest.baseline.json --fail-on-regression`.
8. Add `.behavtest/` to `.gitignore` (`init` does this): the database holds raw inputs and outputs.
9. RAG: the pipeline reports retrieved documents as a `kind: "retrieval"` step whose `output` lists `{ id, text }`; cases list `expectedDocs` for the `retrieval` scorer. `faithfulness` and `contextRelevance` need a judge.
10. To check the judge: the user labels judged answers in `behavtest serve` (saved to the database), then `behavtest calibrate --min-kappa 0.6`. A labels file (JSONL `{ run, case, attempt, scorer, label: "pass" | "fail" }`, exported from the HTML report) works with `--labels <file>`.
11. On GitHub, prefer the Action: `uses: dhrumilbhut/behavtest@v0` with `suite:` (and `repeat:` equal to the baseline's). It needs a committed compact `behavtest.baseline.json`; `comment: true` needs `permissions: pull-requests: write`.
12. To compare models or prompts, add `variants: [{ name, pipeline: { config: {...} } }]` to the suite (at least two; config is merged over `pipeline.config`), run it, then `behavtest matrix`.
13. `behavtest serve` is for a person to look at results; it is not needed in CI. It binds to 127.0.0.1; do not suggest `--host 0.0.0.0` on shared machines.

A machine-readable summary is at [dhrumilbhut.github.io/behavtest/llms.txt](https://dhrumilbhut.github.io/behavtest/llms.txt), and this README as plain text at [llms-full.txt](https://dhrumilbhut.github.io/behavtest/llms-full.txt).

## Security and privacy

- Suite files are safe to commit: secrets are referenced as `${ENV_VAR}`. Resolved values are never written to the database; hard-coded secrets are masked before storing (with a warning).
- The database contains your raw inputs and outputs (and pipeline traces), which may be sensitive. `behavtest init` git-ignores `.behavtest/`. Values under secret-looking keys in traces are masked before storing; `--no-trace` stores none. Compact run files contain no inputs, outputs or traces.
- BehavTest contacts only the URLs and providers you configure. There is no telemetry and no update check.
- `behavtest serve` listens on 127.0.0.1 only by default, refuses unknown `Host` headers (DNS rebinding) and cross-site writes, and writes nothing but your labels. It has no login, so think before exposing it with `--host`.
- Code suites are programs: only run suites you trust.
- Releases are published from GitHub Actions with npm provenance. See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Prior art

BehavTest stands on ideas from [Promptfoo](https://www.promptfoo.dev), [DeepEval](https://deepeval.com), [Inspect AI](https://inspect.aisi.org.uk), and Ragas, and on the pass@k / pass^k reliability framing from τ-bench. If you need a hosted platform, deep RAG metrics today, or production observability, those tools are excellent. BehavTest's bet is a small, vendor-neutral, statistically honest behavioral regression testing tool you can run anywhere.

## Roadmap

Shipped: suites (JSON and code), HTTP / OpenAI / Anthropic / function pipelines, eight built-in scorers including RAG (`retrieval`, `faithfulness`, `contextRelevance`), repeats and flakiness, `compare` with significance tests, judge calibration against your labels, HTML / Markdown / JSON reports, a local dashboard (`behavtest serve`), run files and CI baselines, a GitHub Action, matrix runs across models and prompts, traces. Next: turning production failures into test cases, and a Python client. See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

## Development

```bash
npm ci
npm run check     # lint + typecheck + tests (builds first; e2e tests spawn the built CLI)
npm run build     # dist/ and schema/suite.schema.json
```

Useful scripts: `npm run test:watch`, `npm run lint`, `npm run typecheck`, `npm run sample-report` (a deterministic sample comparison report in `site/`). Node.js 24 or newer.

## Contributing

Contributions are welcome. BehavTest is small on purpose, so please open an issue before a large change.

- **Tests** are real, not mocked: `test/fixtures/mock-pipeline.ts` is a local HTTP server that returns 429s, 500s, malformed JSON, hangs and non-deterministic answers on demand (prefer extending it over mocking `fetch`); `test/fixtures/stub-llm.ts` speaks the Anthropic and OpenAI response shapes so judge and adapter tests need no API keys; `test/e2e/` spawns the *built* CLI and asserts stdout, SQLite rows and exit codes. Tests must be deterministic and touch nothing beyond localhost.
- **Stable contracts:** the adapter and scorer interfaces (`src/core/types.ts`) change only additively.
- **Honesty:** don't claim other tools lack a feature unless you've checked, and only quote numbers that came from real runs.
- **Pull requests:** keep them focused, include tests, run `npm run check`, and add a line under *Unreleased* in `CHANGELOG.md` for user-visible changes. Never commit secrets, API keys or a results database.
- **Security issues:** see [SECURITY.md](SECURITY.md), not a public issue.

## License

[MIT](LICENSE)
