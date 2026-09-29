---
path: comparisons/promptfoo/
title: BehavTest vs Promptfoo
label: BehavTest vs Promptfoo
description: BehavTest and Promptfoo compared: repeated runs, statistical regression detection, assertions, RAG and agent checks, CI, red teaming, and when each fits.
kind: comparison
order: 1
---
# BehavTest vs Promptfoo

Both are open-source command-line tools that run test cases against LLMs and applications and fit into CI. They differ in emphasis: Promptfoo is a broad evaluation and red-teaming toolkit with a large set of assertions and providers; BehavTest is a narrow tool for deciding, with statistics, whether a change made behavior worse than a baseline.

## What is Promptfoo?

[Promptfoo](https://www.promptfoo.dev) is an open-source (MIT) CLI and library, written in TypeScript, for evaluating and red-teaming LLM applications. Tests are declared in YAML configuration: prompts, providers (OpenAI, Anthropic, Google, Azure, local models, custom HTTP and code providers and more) and test cases with `assert` lists. Its documented assertions include deterministic checks (`equals`, `contains`, `regex`, `is-json`, `latency`, `cost`, tool-call validation), model-graded checks (`llm-rubric`, `g-eval`, `factuality`), RAG checks (`context-faithfulness`, `context-recall`, `context-relevance`, `answer-relevance`) and agent trajectory checks (`trajectory:tool-used`, `trajectory:tool-sequence`, `trajectory:step-count` and others); assertions can have thresholds and weights. `promptfoo eval --repeat <n>` runs each test several times, `promptfoo view` opens a local web viewer with side-by-side results, and a GitHub Action posts a before/after comparison on pull requests that change prompts. It runs locally, and it also has a substantial red-teaming feature set for security testing.

## What is BehavTest?

BehavTest is an open-source (MIT) CLI and Node.js library for [behavioral regression testing](/behavioral-regression-testing/). Suites are JSON or TypeScript; the application under test is an HTTP endpoint (any language), an OpenAI-compatible or Anthropic model, or a function. It repeats every case, scores each attempt (deterministic checks, trace checks on tool calls, three RAG scorers, a hardened LLM judge, latency and cost limits, or custom functions), stores every run in SQLite, and compares runs case by case with Fisher's exact test and overall with a case-stratified permutation test. A comparison can fail CI only on statistically significant regressions. It also measures how often the LLM judge agrees with your own labels (Cohen's kappa).

## Feature comparison

| Capability | BehavTest | Promptfoo |
|---|---|---|
| Configuration | JSON or TypeScript/JavaScript suites | YAML configuration (plus code for custom providers and assertions) |
| Repeated execution | Yes: `--repeat` per run, per-case `repeat` | Yes: `--repeat <n>` |
| Pass rate per case with a confidence interval | Yes (Wilson 95%) | Not documented |
| Statistical significance of a change | Yes: Fisher's exact test per case, permutation test overall | Not documented |
| Comparing two runs | `behavtest compare` against a previous run or a committed baseline file | Side-by-side results in the web viewer; the GitHub Action compares before and after on a pull request |
| CI gate | Exit code from `compare` (`--fail-on-regression`, `--significant-only`); GitHub Action with `gate` | Exit code on failed tests; GitHub Action comments with the comparison |
| Deterministic assertions | `exactMatch`, `latencyCost`, and custom functions | Many built in (equality, contains, regex, JSON, SQL, similarity metrics, latency, cost…) |
| LLM-as-a-judge | `llmJudge` with rubric; injection-fenced, schema-validated, pre-run check | `llm-rubric`, `g-eval`, `factuality` and other model-graded assertions |
| Judge calibration against human labels | Yes: `behavtest calibrate` (Cohen's kappa, false-pass rate) | Not documented |
| RAG evaluation | `retrieval` (hit, recall, precision, MRR vs expected document ids), `faithfulness`, `contextRelevance` | `context-faithfulness`, `context-recall`, `context-relevance`, `answer-relevance` |
| Agent / tool-call evaluation | `toolCalled`, `maxSteps` on the steps the application reports | Tool-call validation assertions and `trajectory:*` assertions |
| Red teaming / security testing | No | Yes, a major feature |
| Local results and viewer | SQLite file; single-file HTML report; `behavtest serve` dashboard | Local web viewer (`promptfoo view`); sharing via promptfoo.app or a self-hosted server |
| License | MIT | MIT |

Promptfoo facts from its [introduction](https://www.promptfoo.dev/docs/intro/), [command line](https://www.promptfoo.dev/docs/usage/command-line/), [assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/), [web viewer](https://www.promptfoo.dev/docs/usage/web-ui/) and [GitHub Action](https://www.promptfoo.dev/docs/integrations/github-action/) documentation, checked 2026-09-29.

## When each approach makes sense

**Promptfoo fits when** you want a broad toolkit: many assertion types without writing code, many providers side by side in one configuration, a web viewer to browse outputs, and red teaming for security testing. It is a natural choice for prompt engineering (comparing prompts and models on the same inputs) and for teams already standardized on YAML-configured evals.

**BehavTest fits when** the question is specifically "did this change make my application behave worse?" and your outputs are nondeterministic enough that a single run can't answer it: you want per-case pass rates with intervals, a significance test before failing a build, a committed baseline in the repository, and evidence that your LLM judge agrees with you. It is also a fit when you want to test the real application over HTTP in any language rather than prompts.

**Together:** nothing stops you using Promptfoo for exploration and red teaming and BehavTest as the statistical regression gate on pull requests.

## Related

- [BehavTest vs DeepEval](/comparisons/deepeval/) · [all comparisons](/comparisons/)
- [LLM regression testing](/llm-regression-testing/) · [LLM evaluation](/llm-evaluation/)
