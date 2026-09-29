---
path: integrations/vercel-ai-sdk/
title: Vercel AI SDK regression testing with BehavTest
description: Regression test Vercel AI SDK code with BehavTest: call generateText from a TypeScript suite, check answers, token usage and tool calls, compare runs.
kind: integration
order: 6
---
# Vercel AI SDK

If your application is built on the [AI SDK](https://ai-sdk.dev), a BehavTest code suite can call the same function your application uses, in-process, and check what it does: the answer, the token usage, and the tools a multi-step agent called. BehavTest has no AI SDK plugin; this works because a code suite's pipeline is any async function, and the AI SDK's results map directly onto what BehavTest records.

## Installation

```bash
npm install --save-dev behavtest
npm install ai @ai-sdk/openai zod
export OPENAI_API_KEY=sk-...
```

The suite imports `defineSuite` from `behavtest`, so it needs the local install. Use `"type": "module"` in `package.json` or name the suite `.mts`; Node.js 24 runs TypeScript suites without a build step.

## Setup: testing an answer

`support.suite.ts`:

```ts
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { defineSuite } from "behavtest";

const model = openai("gpt-4.1-mini");

export default defineSuite({
  name: "support-bot",
  defaults: { repeat: 3 },
  pipeline: {
    name: "ai-sdk",
    config: { model: "gpt-4.1-mini", prompt: "v1" },
    run: async (input) => {
      const result = await generateText({
        model,
        system: "You are a concise support agent. Returns are accepted within 30 days.",
        prompt: String(input),
      });
      return {
        output: result.text,
        usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 },
      };
    },
  },
  scorers: {
    statesWindow: ({ output }) => /30 days/.test(output),
  },
  cases: [{ id: "refund-window", input: "How long do I have to return an item?", scorers: ["statesWindow"] }],
});
```

`config` is recorded with every run (secrets are masked), so a report shows which model and prompt version produced it. `statesWindow` is a scorer written as a plain function; built-in scorers such as `llmJudge` can be listed alongside it.

## Setup: testing an agent's tool calls

For a multi-step agent, map the AI SDK's `result.steps` to BehavTest steps and check them with the trace scorers:

```ts
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { defineSuite } from "behavtest";
import { z } from "zod";

const tools = {
  lookup_order: tool({
    description: "Look up an order by id",
    inputSchema: z.object({ orderId: z.number() }),
    execute: async ({ orderId }) => ({ orderId, status: "shipped" }),
  }),
};

export default defineSuite({
  name: "order-agent",
  defaults: { repeat: 3 },
  pipeline: {
    name: "ai-sdk-agent",
    run: async (input) => {
      const result = await generateText({ model: openai("gpt-4.1-mini"), tools, stopWhen: stepCountIs(5), prompt: String(input) });
      return {
        output: result.text,
        steps: result.steps.flatMap((step) =>
          step.toolCalls.map((c) => ({ kind: "tool" as const, name: c.toolName, input: c.input })),
        ),
      };
    },
  },
  cases: [
    { id: "order-status", input: "Where is order 123?", scorers: ["toolCalled", "maxSteps"],
      scorerConfig: { toolCalled: { tool: "lookup_order", argsInclude: { orderId: 123 } }, maxSteps: { max: 3 } } },
  ],
});
```

`toolCalled` passes when the agent called `lookup_order` with `orderId: 123`; `maxSteps` fails an attempt that made more than three tool calls, which catches loops.

## Running the test

```bash
npx behavtest run support.suite.ts
npx behavtest run agent.suite.ts
```

Both suites were run with AI SDK 7 using its `MockLanguageModelV4` from `ai/test` in place of `openai(...)` (for the agent, a mock that first calls the tool, then answers), and type-check with `tsc --strict`. The mock is also a convenient way to try a suite without an API key.

## Regression detection

Change the system prompt, the model or the tool definitions, then:

```bash
npx behavtest run agent.suite.ts --repeat 5 --label new-prompt
npx behavtest compare
```

The comparison shows which behaviors regressed (the wrong tool, missing arguments, more steps, a missing fact) and whether each change is bigger than the run-to-run noise. `behavtest show <run> <case>` prints the recorded tool calls of each attempt.

## CI/CD

The suite runs wherever the project's dependencies are installed: `npm ci`, then the [GitHub Action](/docs/github-action/) with `suite: agent.suite.ts`, or `npx behavtest run` and `npx behavtest compare` in any CI. Provide the provider key as a secret.

## Limitations

- Cost: a function pipeline reports tokens but not dollars. Return `costUsd` yourself if you want cost limits enforced.
- Streaming (`streamText`) is not measured as a stream; call `generateText` in the test, or collect the stream before returning.
- Each attempt is one call of your function. Conversation state, UI hooks and server routes are outside the test unless your function goes through them.

## Links

- BehavTest: [code suites](/docs/code-suites/), [traces](/docs/traces/), [scorers](/docs/scorers/)
- AI SDK: [documentation](https://ai-sdk.dev/docs) · [testing with mock models](https://ai-sdk.dev/docs/ai-sdk-core/testing)
- [BehavTest on GitHub](https://github.com/dhrumilbhut/behavtest) · [BehavTest on npm](https://www.npmjs.com/package/behavtest)
