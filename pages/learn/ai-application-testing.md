---
path: ai-application-testing/
title: AI Application Testing
description: What to test in an AI application, part by part: prompts, model outputs, RAG retrieval, agents and tool calls, external dependencies, cost and latency.
kind: learn
order: 5
---
# AI application testing

An AI application is not just a model. A request passes through prompt assembly, maybe a retriever, one or more model calls, maybe several tool calls, and some post-processing, and each of those parts can regress independently. Testing the application well means knowing which part can go wrong in which way, and checking the right thing at the right place. This page goes through the parts one by one.

## Anatomy of a request

```text
 user input
     |
 prompt assembly ........ system prompt, templates, conversation history
     |
 retrieval (RAG) ........ search the knowledge base, pick top-k documents
     |
 model call(s) .......... generate an answer, or decide on a tool
     |        \
     |      tool calls .. look up an order, query an API, run code
     |        /
 post-processing ........ parse, validate, format
     |
 answer
```

A failure at any step shows up in the final answer, often in a way that looks the same from outside ("the bot gave a wrong answer"). Tests that look inside, at what was retrieved and which tools were called, tell you *where* it went wrong.

## Prompts

**What goes wrong:** an edit to fix one behavior weakens another; a template renders the wrong variables; an instruction conflicts with the retrieved context.

**How to test:** unit-test the template rendering as ordinary code. Test the *effect* of the prompt with behavioral cases: a fixed set of inputs with the property each answer must have, rerun whenever the prompt changes. In BehavTest the prompt is part of the pipeline configuration (for OpenAI-compatible and Anthropic models, the `system` field; for your own code, whatever your function does), and a [matrix run](/docs/matrix/) can compare several prompt versions side by side.

## Model outputs

**What goes wrong:** a model swap, a new model version or a provider change shifts answers; outputs vary between calls even when nothing changed.

**How to test:** check properties, not exact text, and run each case several times, because a single attempt says little about a behavior that holds only most of the time. [Behavioral regression testing](/behavioral-regression-testing/) explains how many attempts you need and how to decide whether a drop is real.

## Retrieval (RAG)

**What goes wrong:** re-chunking, a new embedding model, a changed top-k or a re-indexed corpus stops the right document from being retrieved; the answer then comes from the wrong source or from the model's own memory.

**How to test:** for each case, write down which document ids a correct retrieval returns, and score retrieval deterministically: was the expected document found (hit), how many of them (recall), how many retrieved documents were expected (precision), how high it ranked (MRR). For this to work, the application has to report what it retrieved. In BehavTest the pipeline reports a `retrieval` step, and the `retrieval` scorer compares it with the case's `expectedDocs`:

```json
{
  "id": "refund-time",
  "input": "How long does a refund take?",
  "expectedDocs": ["refunds"],
  "scorers": ["retrieval", "faithfulness"],
  "scorerConfig": { "retrieval": { "metric": "recall", "k": 3 } }
}
```

See [RAG: test retrieval and grounded answers](/docs/rag/), with a runnable example pipeline.

## Grounding

**What goes wrong:** the right documents were retrieved, but the answer adds a claim they don't support (a hallucination), or ignores them.

**How to test:** a judge compares the answer with the retrieved text: supported or not, or claim by claim. It's an LLM check, so it has its own error rate. BehavTest's `faithfulness` scorer checks grounding (one verdict, or a supported fraction of claims), `contextRelevance` checks whether the retrieved documents were relevant at all, and both treat retrieved documents as untrusted input that may contain prompt injection.

## Agents and tool calls

**What goes wrong:** the agent calls the wrong tool, passes the wrong arguments, calls a tool it shouldn't, or loops and burns time and money, and still produces a plausible final answer.

**How to test:** record the steps the agent took and assert on them. The final text can be right for the wrong reason; the trace shows the reason. In BehavTest the pipeline returns its `steps` (from an HTTP response, or with `tracer()` in a TypeScript function), and trace scorers check them:

```json
"scorers": ["toolCalled", "maxSteps"],
"scorerConfig": {
  "toolCalled": { "tool": "lookup_order", "argsInclude": { "orderId": 123 } },
  "maxSteps": { "max": 8 }
}
```

A case using a trace scorer errors (it never silently passes) when the pipeline reported no steps. See [traces](/docs/traces/).

## External dependencies

**What goes wrong:** the model API rate-limits you or times out, a tool's upstream API is down, a key expires. These are failures of the environment, not of behavior, and mixing the two corrupts your results: a quality drop that is really an outage looks like a regression.

**How to test:** keep "the application answered wrongly" separate from "the application could not answer". BehavTest records the second as **errored**: retried for network errors, HTTP 429 and 5xx (honoring `Retry-After`), bounded by a per-attempt timeout, never counted as a pass, and never compared as a regression. An errored case in the new run still fails the regression gate, because a broken pipeline should never be green. For deterministic tests of your tool code, mock the upstream API in ordinary unit tests.

## Latency and cost

**What goes wrong:** a new model or a longer prompt doubles response time or cost per request, with no change in answers.

**How to test:** measure both on every attempt and set thresholds. BehavTest's `latencyCost` scorer fails an attempt above `maxLatencyMs` or `maxCostUsd`. Cost is computed from the provider's reported token usage and a price table; when a price or the usage is unknown the cost is reported as unknown rather than guessed, and a cost limit on an unknown cost errors instead of passing.

## Nondeterminism, across all of it

Every part above that involves a model produces varying results. The practical consequences are the same everywhere: check properties, repeat cases, look at pass rates, and decide on changes statistically. Deterministic parts (templates, parsers, tool implementations) don't need any of this and are better served by ordinary unit tests.

## Summary

| Part | Typical regression | Check | BehavTest |
|---|---|---|---|
| Prompt | An edit weakens a behavior | Behavioral cases, before/after | Suites, `compare`, matrix runs |
| Model output | A model change shifts answers | Properties, repeated attempts | `exactMatch`, `llmJudge`, custom scorers, `--repeat` |
| Retrieval | The right document is no longer found | Hit / recall / precision / MRR at k | `retrieval` with `expectedDocs` |
| Grounding | Unsupported claims | Judge against retrieved text | `faithfulness`, `contextRelevance` |
| Agent actions | Wrong tool, wrong arguments, loops | Assertions on recorded steps | `toolCalled`, `maxSteps` |
| Dependencies | Outages, rate limits, timeouts | Separate "errored" from "failed" | Errored attempts, retries, timeouts |
| Latency and cost | Slower or more expensive | Thresholds per attempt | `latencyCost` |

## What this page doesn't cover

Safety and adversarial testing (red teaming), multi-turn conversation simulation, and monitoring live traffic are real parts of AI application quality, and BehavTest doesn't do them. BehavTest's cases are single requests (conversation history can be passed as input), and it runs before release, not on production traffic.

## Related

- [LLM testing](/llm-testing/): the layers from unit tests to production checks.
- [LLM regression testing](/llm-regression-testing/): the workflow, with CI.
- BehavTest reference: [adapters](/docs/adapters/), [scorers](/docs/scorers/), [traces](/docs/traces/), [RAG](/docs/rag/), [cost](/docs/cost/).
