---
path: integrations/
title: Integrations
description: The ways BehavTest connects to your AI application: OpenAI, Anthropic, Ollama and OpenAI-compatible servers, any HTTP service, LangChain, the Vercel AI SDK, CI.
kind: integration
order: 0
---
# Integrations

BehavTest tests your application where it runs. There are three ways to connect it, and every integration below is one of them:

- **A built-in model adapter** (`openai`, `anthropic`): BehavTest calls the model directly with your system prompt. Best for testing a prompt, or comparing models.
- **The HTTP adapter** (`http`): BehavTest sends each input to an endpoint of your application, in any language, and reads the answer (and optionally the steps it took). Best for testing the real application, with its retrieval, tools and code.
- **A function in a code suite**: a TypeScript or JavaScript suite calls your code in-process. Best for Node.js applications, and for recording an agent's steps with `tracer()`.

Each page below has a working example, the command to run it, what regressions it catches, and its limits. The examples were run against the current versions of each library.

## Model providers

| Integration | How it connects | What you can test |
|---|---|---|
| [OpenAI](/integrations/openai/) | `openai` adapter (Chat Completions) | Prompts and models; OpenAI models as the LLM judge |
| [Anthropic (Claude)](/integrations/anthropic/) | `anthropic` adapter (Messages API) | Prompts and models; Claude models as the LLM judge |
| [Ollama and OpenAI-compatible servers](/integrations/ollama/) | `openai` adapter with `baseUrl` | Local and self-hosted models |

## Applications and frameworks

| Integration | How it connects | What you can test |
|---|---|---|
| [HTTP services: Python, FastAPI, any language](/integrations/http/) | `http` adapter | Your real service end to end, including retrieval and tool steps |
| [LangChain](/integrations/langchain/) | HTTP (Python) or a code suite (LangChain.js) | Chains, retrievers (LangChain documents are read directly in JavaScript) |
| [Vercel AI SDK](/integrations/vercel-ai-sdk/) | A code suite calling `generateText` | Answers, token usage, and the tool calls of multi-step agents |

## CI

| Integration | How it connects |
|---|---|
| [GitHub Actions](/docs/github-action/) | The `dhrumilbhut/behavtest@v0` Action: runs the suite on each pull request, compares it with a committed baseline, writes the job summary, fails the check |
| [Any other CI system](/docs/ci-baselines/) | Two CLI commands and a committed run file; exit code 1 fails the job |

## Not listed here

Frameworks without a page (LlamaIndex, CrewAI, Pydantic AI, Mastra and others) can still be tested through the [HTTP adapter](/integrations/http/): expose one endpoint that takes `{ "input": ... }` and returns `{ "output": "..." }`. BehavTest has no framework-specific support for them, so they have no page of their own.

To use BehavTest from your own program, see the [library API](/docs/library/).
