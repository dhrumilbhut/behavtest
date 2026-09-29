---
path: integrations/openai/
title: OpenAI regression testing with BehavTest
description: Regression test prompts and models on the OpenAI API with BehavTest: suite setup, repeated runs, an OpenAI model as the LLM judge, cost limits, and CI.
kind: integration
order: 1
---
# OpenAI

BehavTest's built-in `openai` adapter sends each test case to an OpenAI model through the Chat Completions API, with your system prompt, and scores the answers. Use it to check that a prompt edit or a model swap (say, to a cheaper model) doesn't make behavior worse. OpenAI models can also be the [LLM judge](/docs/scorers/#the-llm-judge) for any suite.

If what you want to test is your whole application (its retrieval, tools and code), not just a prompt, call the application instead: see [HTTP services](/integrations/http/) or [Vercel AI SDK](/integrations/vercel-ai-sdk/).

## Installation

BehavTest needs Node.js 24 or newer. Nothing else is required: it calls the API over HTTPS itself, without the OpenAI SDK.

```bash
npx behavtest --version
export OPENAI_API_KEY=sk-...          # PowerShell: $env:OPENAI_API_KEY="sk-..."
```

## Setup

Save as `support.suite.json`:

```json
{
  "$schema": "https://unpkg.com/behavtest/schema/suite.schema.json",
  "name": "support-prompt-openai",
  "defaults": { "repeat": 5, "judge": "openai:gpt-4.1-nano" },
  "pipeline": {
    "adapter": "openai",
    "config": {
      "model": "gpt-4.1-mini",
      "system": "You are a concise support agent. Returns are accepted within 30 days.",
      "maxTokens": 300
    }
  },
  "cases": [
    {
      "id": "refund-window",
      "input": "Can I return an item after 40 days?",
      "expected": "No: returns are accepted within 30 days.",
      "scorers": ["llmJudge", "latencyCost"],
      "scorerConfig": {
        "llmJudge": { "rubric": "Does the answer state the 30-day limit and avoid promising an exception?" },
        "latencyCost": { "maxLatencyMs": 5000, "maxCostUsd": 0.001 }
      }
    },
    { "id": "one-word", "input": "Reply with only the word OK.", "expected": "OK", "scorers": ["exactMatch"] }
  ]
}
```

Options of the `openai` adapter (`pipeline.config`):

| Option | Meaning |
|---|---|
| `model` | The model id, e.g. `gpt-4.1-mini` (required) |
| `system` | The system prompt: usually the thing you are testing |
| `maxTokens` | Output token limit, sent as `max_completion_tokens` (or `max_tokens` with `maxTokensParam`) |
| `temperature` | Sent only if you set it; several current OpenAI reasoning models accept only their default |
| `inputTemplate` | Turns an object input into a prompt, e.g. `"{{question}}"` |
| `baseUrl`, `apiKeyEnv` | Another endpoint or key variable (defaults: `OPENAI_BASE_URL` or `https://api.openai.com/v1`, and `OPENAI_API_KEY`) |
| `retries`, `retryBaseDelayMs` | Retries for network errors, HTTP 429 and 5xx (honoring `Retry-After`) |

A case's `input` can be a string (one user message) or `{ "messages": [...] }` (a conversation history).

## Running the test

```bash
npx behavtest run support.suite.json --label gpt-4.1-mini
```

Every case runs five times (`defaults.repeat`). Before any case runs, BehavTest makes one tiny call to the judge to check it works; a wrong model name or key stops the run with exit code 2 instead of erroring every attempt. Token usage from each response is priced with a bundled table (input, cached input and output separately), so the report shows pipeline and judge cost; an unknown model's cost is reported as unknown, never guessed.

## Regression detection

Change something, run again, and compare:

```bash
# edit the system prompt, or change "model" to the candidate
npx behavtest run support.suite.json --label candidate
npx behavtest compare --fail-on-regression --significant-only
```

`compare` shows each case's pass rate before and after, whether the change is statistically significant, and an overall verdict. What it catches here: the answer no longer states the 30-day limit or promises an exception (judge), the one-word format breaks (exact match), or responses get slower or more expensive than the limits (latency and cost).

To compare several models at once, add `variants` to the suite and read them side by side with `behavtest matrix`: see [matrix runs](/docs/matrix/).

## Choosing the judge

Use a different model from the one under test (BehavTest warns when they are the same: judges favor their own output), and pick by measured cost per verdict rather than list price: reasoning models can spend hundreds of hidden tokens on a single verdict. Before relying on a judge, [measure how often it agrees with you](/docs/calibration/).

## CI/CD

Store the key as a repository secret and use the [GitHub Action](/docs/github-action/):

```yaml
      - uses: dhrumilbhut/behavtest@v0
        with:
          suite: support.suite.json
          repeat: 5
          gate: significant
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Every CI run makes real API calls: cases × attempts, plus judge calls. `behavtest run` prints the planned count before it starts.

## Limitations

- The adapter uses the Chat Completions API with a system prompt and messages. Tools, structured outputs and other API features of your application are not exercised: test those through your application ([HTTP](/integrations/http/) or a code suite).
- Long-context pricing tiers are not modeled, so the cost of very long requests is under-reported; treat OpenAI cost as an estimate.
- Each case is one request; multi-turn behavior can be tested by passing a conversation history as input.

## Links

- BehavTest: [adapters](/docs/adapters/), [the LLM judge](/docs/scorers/#the-llm-judge), [cost](/docs/cost/), [quickstart](/docs/quickstart/)
- OpenAI: [API documentation](https://platform.openai.com/docs)
- [BehavTest on GitHub](https://github.com/dhrumilbhut/behavtest) · [BehavTest on npm](https://www.npmjs.com/package/behavtest)
