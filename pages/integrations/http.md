---
path: integrations/http/
title: Regression test any HTTP AI service (Python, FastAPI)
description: Test an AI application in any language with BehavTest's HTTP adapter: the request and response contract, a FastAPI example with tool steps, and CI.
kind: integration
order: 4
---
# HTTP services: Python, FastAPI and any language

BehavTest's `http` adapter tests your real application, whatever it is written in: it POSTs each test case to an endpoint you expose and scores the answer. Because the whole application runs (its prompts, retrieval, tools and business logic), this is the most faithful way to catch regressions, and the way to test frameworks BehavTest has no dedicated support for (LlamaIndex, CrewAI, Pydantic AI, Mastra and others).

## The contract

BehavTest sends, for every attempt:

```json
{ "input": "Where is order 123?" }
```

`input` is the case's input as written in the suite: a string, `{ "messages": [...] }`, or any JSON object you choose. Your endpoint replies with:

```json
{
  "output": "Order 123 was shipped on Monday.",
  "usage": { "inputTokens": 52, "outputTokens": 9 },
  "costUsd": 0.00012,
  "steps": [
    { "kind": "tool", "name": "lookup_order", "input": { "orderId": 123 }, "output": "shipped on Monday" }
  ]
}
```

Only `output` (a string) is required. The rest is optional and unlocks more checks:

| Field | Used for |
|---|---|
| `output` | Every scorer. Another field name can be set with `outputField` |
| `usage` | Token counts (`inputTokens`, `outputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `reasoningTokens`), stored and shown |
| `costUsd` | Your own cost figure for the attempt, used by cost limits |
| `steps` | A trace: `kind` (`llm`, `tool`, `retrieval`, `agent`, `other`), `name`, optional `input`, `output`, `durationMs`, `startOffsetMs`, `attributes`, `children`. Needed for the tool-call and RAG scorers |
| `metadata` | Anything else you want stored with the attempt |

A non-2xx status, invalid JSON or a missing `output` makes the attempt **errored**, not failed; network errors, 429 and 5xx responses are retried first.

## Installation

```bash
npx behavtest --version                  # Node.js 24 or newer on the machine that runs the tests
pip install fastapi uvicorn              # for the Python example below
```

## Setup: a FastAPI endpoint

Add one endpoint that calls your application and reports what it did. `support_agent` stands in for your code:

```python
from fastapi import FastAPI

app = FastAPI()

ORDERS = {123: "shipped on Monday"}


def lookup_order(order_id: int) -> str:
    return ORDERS.get(order_id, "not found")


def support_agent(question: str) -> dict:
    # stand-in for your agent: call your model and tools here
    status = lookup_order(123)
    return {
        "text": f"Order 123 was {status}.",
        "tool_calls": [{"name": "lookup_order", "args": {"orderId": 123}, "result": status}],
        "usage": {"input_tokens": 52, "output_tokens": 9},
    }


@app.post("/behavtest")
def behavtest_endpoint(body: dict):
    result = support_agent(body["input"])
    return {
        "output": result["text"],
        "usage": {"inputTokens": result["usage"]["input_tokens"], "outputTokens": result["usage"]["output_tokens"]},
        "steps": [
            {"kind": "tool", "name": call["name"], "input": call["args"], "output": call["result"]}
            for call in result["tool_calls"]
        ],
    }
```

And a suite, `agent.suite.json`, that checks the answer's behavior through its steps:

```json
{
  "$schema": "https://unpkg.com/behavtest/schema/suite.schema.json",
  "name": "support-agent",
  "defaults": { "repeat": 3 },
  "pipeline": { "adapter": "http", "config": { "url": "${PIPELINE_URL:-http://localhost:8000/behavtest}" } },
  "cases": [
    {
      "id": "order-status",
      "input": "Where is order 123?",
      "scorers": ["toolCalled", "maxSteps", "latencyCost"],
      "scorerConfig": {
        "toolCalled": { "tool": "lookup_order", "argsInclude": { "orderId": 123 } },
        "maxSteps": { "max": 5 },
        "latencyCost": { "maxLatencyMs": 3000 }
      }
    }
  ]
}
```

HTTP adapter options: `url` (required), `method` (`POST`, `PUT` or `PATCH`), `headers` (e.g. `{ "Authorization": "Bearer ${SERVICE_TOKEN}" }`: secrets come from environment variables, never the file), `outputField`, `retries`, `retryBaseDelayMs`.

## Running the test

```bash
uvicorn main:app --port 8000 &
npx behavtest run agent.suite.json
```

```text
  ✓ order-status #1/3      24 ms  toolCalled ✓  maxSteps ✓  latencyCost ✓
  ✓ order-status #2/3      33 ms  toolCalled ✓  maxSteps ✓  latencyCost ✓
  ✓ order-status #3/3      33 ms  toolCalled ✓  maxSteps ✓  latencyCost ✓
```

## Regression detection

Once the endpoint reports its steps, a suite can check far more than the final text: that the agent called the right tool with the right arguments (`toolCalled`), didn't loop (`maxSteps`), retrieved the right documents (`retrieval`, with `expectedDocs` on the case), stayed grounded in them (`faithfulness`), and stayed within latency and cost limits. Add an LLM judge with a rubric for the answer itself. After a change, `behavtest compare` reports which of those behaviors regressed and whether the change is larger than the noise. For a retrieval example, see [LangChain](/integrations/langchain/) or [RAG](/docs/rag/).

## CI/CD

Start the service in the CI job, then run BehavTest against it; with the [GitHub Action](/docs/github-action/):

```yaml
      - run: pip install -r requirements.txt && (uvicorn main:app --port 8000 &) && sleep 3
      - uses: dhrumilbhut/behavtest@v0
        with:
          suite: agent.suite.json
          repeat: 3
```

## Limitations

- BehavTest sees only what the endpoint returns: report steps if you want them checked.
- Each attempt is one request. For multi-turn behavior, pass the conversation as input and keep the endpoint stateless between attempts, or attempts will influence each other.
- The endpoint is test-only surface area: protect it (a token header, or only expose it in test environments).

## Links

- BehavTest: [adapters](/docs/adapters/), [traces](/docs/traces/), [scorers](/docs/scorers/), [guide: test a Python, LangChain or other HTTP service](/guides/test-a-python-langchain-or-other-http-service/)
- FastAPI: [documentation](https://fastapi.tiangolo.com)
- [BehavTest on GitHub](https://github.com/dhrumilbhut/behavtest) · [BehavTest on npm](https://www.npmjs.com/package/behavtest)
