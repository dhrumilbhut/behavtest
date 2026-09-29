---
path: llm-testing/
title: LLM Testing
description: A practical guide to testing LLM applications: unit tests, integration tests, evaluation, regression testing, nondeterminism and CI, and what each catches.
kind: learn
order: 4
---
# LLM testing

Testing an LLM application is not one activity but several, each answering a different question. Some of them are ordinary software tests that happen to sit next to a model; others only make sense because the model is nondeterministic. Mixing them up is how teams end up with either a flaky test suite nobody trusts or no tests at all. This page lays out the layers, what each one catches, and where a regression-testing tool such as BehavTest belongs among them.

## The layers

```text
  unit tests          deterministic code around the model         every commit, milliseconds, no API calls
  integration tests   the real model call works end to end        every commit or PR, a few calls
  evaluation          how good is it, on a dataset                when choosing or reporting, many calls
  regression tests    did this change make behavior worse         every PR that touches the AI path
  production checks   what is happening with real traffic         continuously, after release
```

| Layer | Question it answers | Deterministic? | BehavTest's role |
|---|---|---|---|
| Unit tests | Does my code (templates, parsers, tools) do what I wrote? | Yes | None: use your usual test runner |
| Integration tests | Does the whole path run: keys, network, schemas, tool wiring? | Mostly | Partly: a run errors (exit 1) when the pipeline fails |
| Evaluation | How good are the answers, in absolute terms? | No | Partly: scorers and pass rates, but no benchmark library |
| Regression tests | Did a change make behavior worse than a baseline? | No | Its core purpose |
| Production checks | Is live traffic going wrong right now? | No | None: use an observability tool |

## Unit tests: the code around the model

Most of an LLM application is ordinary code: building prompts, parsing responses, implementing tools, routing between steps. Test it the ordinary way, with the model replaced by a fixed response. These tests are fast, free and deterministic, and they catch the bugs that have nothing to do with the model:

```ts
// parseAnswer.test.ts: an ordinary unit test (vitest); no model is called
import { expect, test } from "vitest";
import { parseRefundDays } from "./parseAnswer.ts";

test("extracts the refund window from the model's answer", () => {
  expect(parseRefundDays("Returns are accepted within 30 days.")).toBe(30);
  expect(parseRefundDays("We don't accept returns on sale items.")).toBeNull();
});
```

If a test here is flaky, it is a real bug, exactly as in any other codebase.

## Integration tests: the real call works

An integration test sends a real request through the real stack and checks that it completes: the key is valid, the model name exists, the response has the expected shape, the tool definitions are accepted. It usually runs once per case and asserts structure, not quality. Failures are mostly infrastructure: an expired key, a renamed model, a schema the provider now rejects.

BehavTest separates this kind of failure from a quality failure: an attempt where the pipeline could not produce an answer is **errored**, not failed, and errors make the run exit non-zero. Before any case runs it also checks that the configured LLM judge works, and stops with a configuration error (exit 2) if it doesn't.

## Evaluation: how good is it?

Evaluation measures quality on a dataset: accuracy against references, rubric scores from an LLM judge, groundedness for RAG, task success for agents. It answers questions like "which model should we use?" or "how good is this assistant?", and produces numbers rather than a pass/fail decision. [LLM evaluation](/llm-evaluation/) covers methods, LLM-as-a-judge, and offline versus online evaluation.

## Regression tests: did this change make it worse?

A regression test compares the behavior after a change with a baseline and decides pass or fail. Because the outputs are nondeterministic, it needs behavioral assertions instead of exact outputs, several attempts per case, and a statistical comparison instead of a single red/green result. That is what BehavTest does:

```bash
npx behavtest init --ts                      # a code suite with a stand-in agent, no API key needed
npx behavtest run behavtest/suite.mts --repeat 5 --label before
# edit the prompt or the agent
npx behavtest run behavtest/suite.mts --repeat 5 --label after
npx behavtest compare --fail-on-regression
```

[LLM regression testing](/llm-regression-testing/) walks through the full workflow, including how many attempts to use and which gate to put in CI.

## Nondeterminism changes what "a failing test" means

In the first two layers a failing test means something is broken. In the last three a single failed attempt may be the system's normal behavior: a case that is right 90% of the time fails one attempt in ten. Two consequences:

- **Don't run nondeterministic checks as ordinary unit tests.** A test runner that fails on any single failure will be red randomly, and a test suite that is red randomly stops being read.
- **Measure rates, and compare them.** Repeat each case, report its pass rate and whether it is flaky, and decide on changes with a significance test. [Behavioral regression testing](/behavioral-regression-testing/) shows why with real numbers.

## Behavioral assertions

Every nondeterministic layer checks properties rather than exact text. The cheapest property that captures what you care about is the best one:

- a required fact or keyword is present (deterministic)
- a fixed answer matches after normalization (deterministic)
- the output is valid JSON with the required fields (deterministic)
- the agent called the right tool with the right arguments (deterministic, from the recorded steps)
- the right documents were retrieved (deterministic, given the expected document ids)
- the answer is supported by the retrieved documents (an LLM judge)
- the answer is correct by a rubric (an LLM judge)

BehavTest's built-in scorers cover these (`exactMatch`, `toolCalled`, `maxSteps`, `retrieval`, `faithfulness`, `contextRelevance`, `llmJudge`, `latencyCost`), and any other check is a function in a [code suite](/docs/code-suites/).

## CI/CD: what runs where

Model calls cost money and time, so not every layer belongs on every commit:

- **Every commit:** unit tests (no model calls).
- **Every pull request that touches the AI path:** the regression suite with a few attempts per case, compared with a committed baseline. The [GitHub Action](/docs/github-action/) or the [CLI recipes](/docs/ci-baselines/) do this.
- **Before choosing a model or prompt:** a larger evaluation, or a [matrix run](/docs/matrix/) across candidates with more attempts.
- **After release:** production monitoring and turning real failures into new regression cases.

## Where BehavTest fits, and where it doesn't

BehavTest covers the regression layer and part of the evaluation layer: it runs cases through the real application, repeats them, scores behavior, and compares runs statistically, locally and in CI. It does not replace unit tests for your own code, does not ship a benchmark or a large metric library, does not red-team for safety, and does not monitor production traffic. Pair it with the tools that do.

## Related

- [LLM regression testing](/llm-regression-testing/) · [AI application testing](/ai-application-testing/) · [LLM evaluation](/llm-evaluation/)
- BehavTest reference: [concepts](/docs/concepts/), [scorers](/docs/scorers/), [exit codes and storage](/docs/exit-codes-and-storage/)
