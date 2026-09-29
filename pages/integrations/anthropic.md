---
path: integrations/anthropic/
title: Anthropic Claude regression testing with BehavTest
description: Regression test prompts and Claude models with BehavTest: a suite for the Anthropic Messages API, repeated runs, Claude as the LLM judge, and CI.
kind: integration
order: 2
---
# Anthropic (Claude)

BehavTest's built-in `anthropic` adapter sends each test case to a Claude model through the Anthropic Messages API, with your system prompt, and scores the answers. Use it to check that a prompt change or a switch between Claude models keeps behavior intact. Claude models can also be the [LLM judge](/docs/scorers/#the-llm-judge) for any suite.

To test your whole application rather than a prompt, call the application instead: see [HTTP services](/integrations/http/).

## Installation

BehavTest needs Node.js 24 or newer; it calls the API over HTTPS itself, without the Anthropic SDK.

```bash
npx behavtest --version
export ANTHROPIC_API_KEY=sk-ant-...   # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
```

## Setup

Save as `support.suite.json`:

```json
{
  "$schema": "https://unpkg.com/behavtest/schema/suite.schema.json",
  "name": "support-prompt-claude",
  "defaults": { "repeat": 5, "judge": "anthropic:claude-sonnet-5" },
  "pipeline": {
    "adapter": "anthropic",
    "config": {
      "model": "claude-haiku-4-5",
      "system": "You are a concise support agent. Returns are accepted within 30 days.",
      "maxTokens": 300
    }
  },
  "cases": [
    {
      "id": "refund-window",
      "input": "Can I return an item after 40 days?",
      "scorers": ["llmJudge"],
      "scorerConfig": { "llmJudge": { "rubric": "Does the answer state the 30-day limit and avoid promising an exception?" } }
    },
    { "id": "one-word", "input": "Reply with only the word OK.", "expected": "OK", "scorers": ["exactMatch"] }
  ]
}
```

The `anthropic` adapter takes the same options as `openai` (`model`, `system`, `maxTokens`, `temperature`, `inputTemplate`, `baseUrl`, `apiKeyEnv`, `retries`), with two differences: `maxTokens` defaults to 1024 because the Messages API requires a limit, and the key and endpoint come from `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`. The judge here is a different model from the one under test, which avoids a judge favoring its own output. To judge with an OpenAI model instead, set `"judge": "openai:gpt-4.1-nano"` and provide both keys.

## Running the test

```bash
npx behavtest run support.suite.json --label haiku-4-5
```

Each case runs five times. BehavTest checks the judge with one tiny call before any case runs, records which judge model and temperature produced each verdict, and prices token usage (including prompt-cache reads and writes) from its bundled table.

## Regression detection

```bash
# edit the system prompt, or change "model"
npx behavtest run support.suite.json --label candidate
npx behavtest compare --fail-on-regression --significant-only
```

The comparison reports each case that regressed or improved, whether the change is larger than the noise, and an overall verdict. For several Claude models side by side, use [matrix runs](/docs/matrix/).

## CI/CD

```yaml
      - uses: dhrumilbhut/behavtest@v0
        with:
          suite: support.suite.json
          repeat: 5
          gate: significant
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

See the [GitHub Action](/docs/github-action/), or [baselines and CI](/docs/ci-baselines/) for other CI systems.

## Limitations

- The adapter sends a system prompt and messages. Tool use, extended thinking and other features your application may rely on are not exercised: test them through your application.
- The Anthropic adapter is covered by BehavTest's tests against a local stand-in of the API; the OpenAI adapter has additionally been checked against the real API.
- Each case is one request; pass `{ "messages": [...] }` as input to test with a conversation history.

## Links

- BehavTest: [adapters](/docs/adapters/), [the LLM judge](/docs/scorers/#the-llm-judge), [judge calibration](/docs/calibration/), [cost](/docs/cost/)
- Anthropic: [API documentation](https://platform.claude.com/docs)
- [BehavTest on GitHub](https://github.com/dhrumilbhut/behavtest) · [BehavTest on npm](https://www.npmjs.com/package/behavtest)
