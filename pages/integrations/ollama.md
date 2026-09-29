---
path: integrations/ollama/
title: Ollama and local LLM regression testing with BehavTest
description: Regression test local and self-hosted models with BehavTest: Ollama and other OpenAI-compatible servers through the openai adapter, with a working example.
kind: integration
order: 3
---
# Ollama and OpenAI-compatible servers

Ollama serves local models through an OpenAI-compatible API, so BehavTest's `openai` adapter can test them: point `baseUrl` at the local server and name the model. The same works for other servers that implement the OpenAI Chat Completions API (for example vLLM or OpenRouter). Use it to check a prompt on a local model, to compare a local model with a hosted one, or to test without API costs.

## Installation

Install [Ollama](https://ollama.com), pull a model, and check that the server answers:

```bash
ollama pull codellama:7b
curl http://localhost:11434/v1/models
npx behavtest --version        # Node.js 24 or newer
```

## Setup

Save as `ollama.suite.json`:

```json
{
  "name": "local-model",
  "defaults": { "repeat": 3 },
  "pipeline": {
    "adapter": "openai",
    "config": {
      "baseUrl": "http://localhost:11434/v1",
      "apiKeyEnv": "OLLAMA_API_KEY",
      "model": "codellama:7b",
      "system": "Answer with a single word, without punctuation.",
      "maxTokens": 20
    }
  },
  "cases": [
    { "id": "capital", "input": "What is the capital of France?", "expected": "Paris",
      "scorers": ["exactMatch", "latencyCost"], "scorerConfig": { "latencyCost": { "maxLatencyMs": 60000 } } },
    { "id": "color", "input": "What color is a clear daytime sky?", "expected": "Blue", "scorers": ["exactMatch"] }
  ]
}
```

- **`baseUrl`** is the server's OpenAI-compatible root (Ollama: `http://localhost:11434/v1`). BehavTest posts to `<baseUrl>/chat/completions`.
- **`apiKeyEnv`**: the adapter always sends a key. Ollama ignores it, so any value works; naming a separate variable keeps your real `OPENAI_API_KEY` from being sent to the local server.
- **`maxTokensParam`**: BehavTest sends the output limit as `max_completion_tokens`. If a server only understands the older `max_tokens`, add `"maxTokensParam": "max_tokens"`.

## Running the test

```bash
OLLAMA_API_KEY=ollama npx behavtest run ollama.suite.json
# PowerShell: $env:OLLAMA_API_KEY="ollama"; npx behavtest run ollama.suite.json
```

A real run of this suite against `codellama:7b` on a laptop (abridged):

```text
  ✓ capital #2/3   9,568 ms  exactMatch ✓  latencyCost ✓
  ✓ capital #3/3   9,637 ms  exactMatch ✓  latencyCost ✓
  ✗ color #2/3       287 ms  exactMatch ✗ (expected "Blue", got "Creamy")
  ✓ color #3/3       264 ms  exactMatch ✓

  cases 2 · passed 1 · failed 0 · flaky 1 · errored 0
  attempts 6 · passed 5 · failed 1 · errored 0
  latency avg 6,449 ms · p95 9,637 ms
  cost pipeline unknown

  ~ flaky: color (2/3 attempts passed)
```

This is the nondeterminism BehavTest is built for: the same question got "Blue" twice and "Creamy" once, so the case is **flaky**, not simply passed or failed. Cost is reported as unknown because a local model has no price; BehavTest never guesses one. The first request is slow while the model loads, which is why the latency limit here is generous.

## Regression detection

Change the prompt or the model (for example a newer local model), run again, and compare:

```bash
OLLAMA_API_KEY=ollama npx behavtest run ollama.suite.json --repeat 10 --label candidate
npx behavtest compare
```

Small local models are often quite random, so use enough attempts (10 or more per case) for the comparison to separate a real drop from noise, and gate on significant changes. See [LLM regression testing](/llm-regression-testing/).

A local model can also be the judge (`"judge": "openai:<model>"` with `OPENAI_BASE_URL` pointing at the server), but the judge requires JSON-schema structured output, which not every local server or model supports. BehavTest checks the judge before the run and stops with a clear message if it can't produce a valid verdict.

## CI/CD

A GitHub-hosted runner has no local model server; run the suite on a machine that does (a self-hosted runner), or start the server in the job before running BehavTest. The commands are the same: `behavtest run`, then `behavtest compare` against a committed baseline. See [baselines and CI](/docs/ci-baselines/).

## Limitations

- Only the Chat Completions endpoint is used; server-specific features are not exercised.
- Compatibility varies between servers and versions (parameter names, structured output). The example above was run against Ollama 0.34.
- No cost tracking for local models, unless you add your own prices to the suite (`pricing`).

## Links

- BehavTest: [adapters](/docs/adapters/), [suite format](/docs/suite-format/), [configuration](/docs/configuration/)
- Ollama: [ollama.com](https://ollama.com) · [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [BehavTest on GitHub](https://github.com/dhrumilbhut/behavtest) · [BehavTest on npm](https://www.npmjs.com/package/behavtest)
