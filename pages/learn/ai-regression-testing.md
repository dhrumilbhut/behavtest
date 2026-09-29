---
path: ai-regression-testing/
title: AI Regression Testing
description: How regression testing changes for AI applications: nondeterministic outputs, behavioral assertions, evaluation versus regression, and practical examples.
kind: learn
order: 3
---
# AI regression testing

Regression testing answers one question: **did a change break something that used to work?** In traditional software the answer comes from rerunning tests whose expected results never change. AI applications keep the question but break most of the machinery behind the answer. This page contrasts the two, lists where regressions in AI applications actually come from, and shows what an AI regression test has to do differently.

## Regression testing in traditional software

A conventional regression suite rests on three assumptions:

- **Determinism.** The same input produces the same output, so one run is enough.
- **An exact oracle.** The expected result can be written down precisely: `add(2, 2) === 4`, a status code, a rendered snapshot.
- **Flakiness is a bug.** A test that sometimes fails is broken (a race, a timing dependency) and gets fixed or quarantined.

Under those assumptions a single red test is strong evidence, and the tooling (unit test runners, snapshot files, CI that fails on any failure) follows naturally.

## What changes for AI applications

| | Traditional software | AI application |
|---|---|---|
| Same input, same output? | Yes | No: sampled outputs vary between calls |
| Expected result | Exact value or snapshot | A property of the answer: a fact, a rubric, a tool call, grounding |
| Who decides pass/fail | An equality check | A deterministic check where possible, otherwise a model (an LLM judge) |
| A test that sometimes fails | A bug in the test | Often the true behavior of the system: a case with a pass rate below 100% |
| Evidence needed | One run | Several attempts per case, compared statistically |
| A change "breaks" something when | Any test turns red | The pass rate drops by more than the noise |

The last row is the core difference. An AI regression test cannot treat one failed attempt as proof, because a correct system fails some attempts by chance, and it cannot treat one passed attempt as proof either. It has to estimate how often each behavior holds, before and after, and decide whether the difference is real. [Behavioral regression testing](/behavioral-regression-testing/) explains the statistics.

## Where regressions in AI applications come from

Many regressions arrive without anyone touching the code that looks responsible:

- **Prompt edits.** A new instruction fixes one behavior and quietly weakens another (a tone change drops a required disclaimer).
- **Model changes.** Swapping to a cheaper model, a new model version, or a provider retiring the model you used.
- **Retrieval changes.** New chunk sizes, a different embedding model, a re-indexed corpus, a changed top-k: the right document stops being retrieved.
- **Tool and schema changes.** A renamed tool, a changed argument, a new tool the agent now prefers.
- **Framework and SDK upgrades.** A library update changes default parameters, prompt formatting or parsing.
- **Data drift in inputs.** Real questions move away from what the prompt was tuned for; covering them means adding cases.

A useful AI regression suite is the set of behaviors you'd be embarrassed to lose when any of these happens.

## Behavioral assertions

Instead of asserting an exact output, an AI regression test asserts properties. Common ones, from cheapest to most expensive:

- **Contains or matches:** the answer states "30 days", or matches a pattern. Deterministic and free.
- **Normalized equality:** for fixed answers such as a label or a number.
- **Structure:** valid JSON, a required field present, a function call with a valid shape.
- **Action:** the agent called `lookup_order` with `orderId: 123`, and took at most eight steps.
- **Retrieval:** the expected document ids appear in the top results.
- **Grounding:** every claim in the answer is supported by the retrieved text (usually an LLM judge).
- **Rubric:** the answer is correct and complete by a written rubric (an LLM judge).
- **Budget:** latency and cost below a threshold.

Each assertion turns one attempt into pass or fail; repeating the case turns those into a pass rate.

## Evaluation versus regression testing

The two are easy to confuse because they share the same parts (datasets, scorers, judges):

- **Evaluation** measures *how good* the system is: an absolute score on a dataset, often to choose between options or report quality.
- **Regression testing** asks *whether a change made it worse* than a known baseline, and turns the answer into a pass/fail decision that can block a merge.

A system can score 72% on an evaluation and pass its regression tests every day, as long as it keeps scoring 72%. [LLM evaluation](/llm-evaluation/) covers the difference in detail.

## Practical examples

**Switching to a cheaper model.** Run the same suite through the current and the candidate model with enough attempts, and compare pass rates case by case, plus latency and cost. With BehavTest, [matrix runs](/docs/matrix/) do this in one command: each model is a variant, and every variant is compared with a reference using the same statistics.

**Editing a system prompt.** Record a baseline before the edit, rerun after, and compare. Cases that regressed significantly are the ones to read; cases that only wobble are noise. See [check whether a prompt or model change made things worse](/guides/check-whether-a-prompt-or-model-change-made-things-worse/).

**Changing RAG chunking.** List, for each case, the document ids a correct retrieval returns, and score retrieval deterministically (`recall` at `k`) alongside a grounding check on the answer. A drop in retrieval recall with stable answers usually means the model is compensating from its own knowledge, which is its own risk. See [RAG](/docs/rag/).

**Refactoring an agent's tools.** Assert the tool calls, not the final text: which tool, which arguments, how many steps. See [traces](/docs/traces/).

## Where BehavTest fits

BehavTest is a regression-testing tool for this setting: it runs your cases through the real application (an HTTP endpoint, an OpenAI-compatible or Anthropic model, or a TypeScript function), repeats them, scores behavior with deterministic checks, trace checks, RAG checks or an LLM judge, and compares runs with significance tests, locally or in CI. It is not a benchmark suite, a red-teaming tool or a production monitor, and it doesn't replace ordinary unit tests for the deterministic code around your model. [When to use BehavTest](/docs/when-to-use/) lists the fit in detail.

## Related

- [Behavioral regression testing](/behavioral-regression-testing/): definitions and the statistics behind a sound verdict.
- [LLM regression testing](/llm-regression-testing/): the step-by-step workflow, with CI.
- [AI application testing](/ai-application-testing/): what to test in each part of an AI application.
- [LLM testing](/llm-testing/): how regression tests fit alongside unit tests and evaluations.
