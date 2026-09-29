---
path: comparisons/langsmith/
title: BehavTest vs LangSmith
label: BehavTest vs LangSmith
description: BehavTest and LangSmith compared: a local regression-testing CLI versus a hosted platform for tracing, evaluation and monitoring, and when each fits.
kind: comparison
order: 4
---
# BehavTest vs LangSmith

LangSmith and BehavTest both run datasets of test inputs through an application and compare results across versions. LangSmith does it as part of a hosted platform that also traces and monitors production traffic; BehavTest does it as a local command-line tool focused on one decision: did this change make behavior worse?

## What is LangSmith?

[LangSmith](https://docs.langchain.com/langsmith/evaluation-concepts) is a platform from LangChain for tracing, evaluating and monitoring LLM applications. For evaluation it has **datasets** (examples with inputs and reference outputs) and **experiments** (the results of running one version of an application on a dataset, with outputs, evaluator scores and traces), which can be compared side by side. Evaluators include code, LLM-as-a-judge (reference-free or against references) and **pairwise** evaluation of two versions. It supports **offline evaluation** before deployment (benchmarking, regression and unit testing) and **online evaluation** of production runs. Setting `num_repetitions` runs each example several times; the UI shows the average of each score and the standard deviation across repetitions. LLM-as-a-judge evaluators can be aligned with human judgment: tested against human-labeled examples for an alignment score, and improved with human corrections used as few-shot examples. It integrates with pytest and Vitest/Jest. It is used as a hosted service; self-hosting is an add-on to the Enterprise plan. Its SDK is open source (MIT).

## What is BehavTest?

BehavTest is an open-source (MIT) CLI and Node.js library for [behavioral regression testing](/behavioral-regression-testing/), run on your machine or in CI with no account. It runs each case repeatedly through your application (HTTP in any language, OpenAI-compatible or Anthropic models, or a function), scores every attempt, stores runs in a local SQLite file, and decides with significance tests whether a change regressed, per case and overall. Results are browsed in a local dashboard or a single-file HTML report.

## Feature comparison

| Capability | BehavTest | LangSmith |
|---|---|---|
| Deployment | Local CLI; results in a SQLite file you own | Hosted platform; self-hosting on the Enterprise plan |
| Datasets and runs | Suites (JSON or TypeScript) and stored runs | Datasets and experiments |
| Repeated execution | Yes: `--repeat` | Yes: `num_repetitions` |
| Summary of repetitions | Pass rate per case with a Wilson 95% interval; flaky cases | Average score and standard deviation per example |
| Statistical significance of a change | Yes: Fisher's exact test per case, permutation test overall | Not documented |
| Comparing versions | `behavtest compare` against a previous run or a committed baseline file | Side-by-side experiment comparison; pairwise evaluators |
| LLM-as-a-judge | `llmJudge`, `faithfulness`, `contextRelevance` | LLM-as-a-judge evaluators, reference-based or reference-free |
| Judge agreement with human labels | `behavtest calibrate`: Cohen's kappa (chance-corrected) with an interval, false-pass rate, and a CI gate on kappa | Alignment testing of LLM-as-a-judge evaluators against human-labeled examples (percentage agreement); human corrections can be added as few-shot examples |
| Tracing | The steps each attempt reports, stored and shown per case | Full tracing of application runs, a core feature |
| Online evaluation / production monitoring | No | Yes |
| CI gate | Exit codes; GitHub Action comparing each pull request with a baseline | pytest and Vitest/Jest integrations |
| Team collaboration | Local dashboard; files you share | Shared hosted workspace |
| License | MIT | Hosted service; SDK is MIT |

LangSmith facts from its [evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts), [repetitions](https://docs.langchain.com/langsmith/repetition), [improving judges with human feedback](https://docs.langchain.com/langsmith/improve-judge-evaluator-feedback) and [self-hosting](https://docs.langchain.com/langsmith/self-hosted) documentation and the [SDK repository](https://github.com/langchain-ai/langsmith-sdk), checked 2026-09-29.

## When each approach makes sense

**LangSmith fits when** you want one platform for the whole lifecycle: tracing in development and production, datasets and experiments shared across a team, online evaluation of live traffic, and deep integration with LangChain and LangGraph.

**BehavTest fits when** you want a small, local, vendor-neutral regression gate: no account, results in a file, a baseline committed next to the code, and a statistical answer to "did this pull request make behavior worse?" before it merges. It is not a tracing or monitoring product.

**Together:** trace and monitor with a platform, and gate merges with BehavTest; production failures you find in the platform become new cases in the BehavTest suite.

## Related

- [LLM evaluation: offline versus online](/llm-evaluation/) · [LLM regression testing](/llm-regression-testing/)
- [BehavTest vs Promptfoo](/comparisons/promptfoo/) · [all comparisons](/comparisons/)
