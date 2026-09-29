---
path: integrations/langchain/
title: LangChain regression testing with BehavTest
label: LangChain
description: Regression test LangChain chains and RAG pipelines with BehavTest: Python over HTTP or LangChain.js in-process, with retrieval checked against expected docs.
kind: integration
order: 5
---
# LangChain

BehavTest tests LangChain applications in two ways: a **Python** chain behind a small HTTP endpoint, or a **LangChain.js** chain called in-process from a TypeScript suite. Either way, the application reports what its retriever returned, so BehavTest can check retrieval (did the right document come back?) as well as the answer (is it right, and grounded in that document?). This is the setup for catching the typical LangChain regressions: a prompt edit, a model swap, a new retriever or re-chunked index.

## Python: a chain behind an endpoint

### Installation

```bash
pip install fastapi uvicorn langchain-core langchain-openai
npx behavtest --version                  # Node.js 24 or newer
```

### Setup

Expose the chain through one endpoint that returns the answer and a `retrieval` step. `retrieve` stands in for your vector store's retriever (`retriever.invoke(question)`):

```python
from fastapi import FastAPI
from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

DOCS = [
    Document(page_content="Refunds are issued within 5 business days.", metadata={"id": "refunds"}),
    Document(page_content="Standard shipping takes 3 to 5 business days.", metadata={"id": "shipping"}),
]


def retrieve(question: str, k: int = 2) -> list[Document]:
    # stand-in for your vector store's retriever: rank by shared words
    words = set(question.lower().split())
    return sorted(DOCS, key=lambda d: -len(words & set(d.page_content.lower().split())))[:k]


prompt = ChatPromptTemplate.from_messages([
    ("system", "Answer only from this context:\n{context}"),
    ("human", "{question}"),
])
chain = prompt | ChatOpenAI(model="gpt-4.1-mini") | StrOutputParser()

app = FastAPI()


@app.post("/answer")
def answer(body: dict):
    question = body["input"]
    docs = retrieve(question)
    output = chain.invoke({"question": question, "context": "\n\n".join(d.page_content for d in docs)})
    return {
        "output": output,
        "steps": [
            {"kind": "retrieval", "name": "search",
             "output": [{"id": d.metadata["id"], "text": d.page_content} for d in docs]},
            {"kind": "llm", "name": "answer"},
        ],
    }
```

Python documents serialize as `page_content`, which BehavTest doesn't read, so the endpoint maps each one to `{ "id", "text" }`. The id is what `expectedDocs` in the suite refers to.

The suite, `rag.suite.json`:

```json
{
  "$schema": "https://unpkg.com/behavtest/schema/suite.schema.json",
  "name": "rag-service",
  "defaults": { "repeat": 3, "judge": "openai:gpt-4.1-nano" },
  "pipeline": { "adapter": "http", "config": { "url": "${PIPELINE_URL:-http://localhost:8000/answer}" } },
  "cases": [
    { "id": "refund-time", "input": "How long does a refund take?", "expectedDocs": ["refunds"],
      "scorers": ["retrieval", "faithfulness"], "scorerConfig": { "retrieval": { "metric": "hit", "k": 1 } } },
    { "id": "shipping-time", "input": "How long does standard shipping take?", "expectedDocs": ["shipping"],
      "scorers": ["retrieval", "faithfulness"], "scorerConfig": { "retrieval": { "metric": "hit", "k": 1 } } }
  ]
}
```

### Running the test

```bash
export OPENAI_API_KEY=sk-...
uvicorn app:app --port 8000 &
npx behavtest run rag.suite.json
```

To try the endpoint without a key, replace `ChatOpenAI(...)` with `FakeListChatModel(responses=["A refund is issued within 5 business days."])` from `langchain_core.language_models.fake_chat_models`, and drop `faithfulness` (it needs a judge).

## JavaScript: LangChain.js in a code suite

In a Node.js project, the suite can call the chain directly, with no endpoint. `tracer()` records the retrieval and the model call as steps, and LangChain.js `Document` objects can be returned as they are: BehavTest reads `pageContent` and takes the id from `metadata.id` (or `metadata.source`).

### Installation

```bash
npm install --save-dev behavtest
npm install @langchain/core @langchain/openai
```

The suite imports `defineSuite` and `tracer` from `behavtest`, so it needs the local install. The project's `package.json` should say `"type": "module"` (or name the suite `.mts`).

### Setup

`rag.suite.ts`:

```ts
import { Document } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { defineSuite, tracer } from "behavtest";

const docs = [
  new Document({ pageContent: "Refunds are issued within 5 business days.", metadata: { id: "refunds" } }),
  new Document({ pageContent: "Standard shipping takes 3 to 5 business days.", metadata: { id: "shipping" } }),
];
// stand-in for your vector store's retriever: rank by shared words
const retrieve = async (q: string) => {
  const words = new Set(q.toLowerCase().split(/\W+/));
  const score = (d: Document) => d.pageContent.toLowerCase().split(/\W+/).filter((w) => words.has(w)).length;
  return [...docs].sort((a, b) => score(b) - score(a)).slice(0, 2);
};
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "Answer only from this context:\n{context}"],
  ["human", "{question}"],
]);
const chain = prompt.pipe(new ChatOpenAI({ model: "gpt-4.1-mini" })).pipe(new StringOutputParser());

export default defineSuite({
  name: "langchain-rag",
  defaults: { repeat: 3 },
  pipeline: {
    name: "langchain-chain",
    run: async (input) => {
      const t = tracer();
      const question = String(input);
      const found = await t.step("retrieval", "search", () => retrieve(question));
      const output = await t.step("llm", "answer", () =>
        chain.invoke({ question, context: found.map((d) => d.pageContent).join("\n\n") }),
      );
      return { output, steps: t.steps };
    },
  },
  scorers: {
    mentionsFiveDays: ({ output }) => /5 business days/.test(output),
  },
  cases: [
    { id: "refund-time", input: "How long does a refund take?", expectedDocs: ["refunds"],
      scorers: ["retrieval", "mentionsFiveDays"], scorerConfig: { retrieval: { metric: "hit", k: 1 } } },
  ],
});
```

### Running the test

```bash
export OPENAI_API_KEY=sk-...
npx behavtest run rag.suite.ts
```

Without a key, swap `new ChatOpenAI(...)` for `new FakeListChatModel({ responses: ["A refund is issued within 5 business days."] })` from `@langchain/core/utils/testing`: the suite then runs as-is. (The fake-model variants of both examples were run with `@langchain/core` 1.2 and Python `langchain-core` 1.6; the `ChatOpenAI` variants were type-checked and imported, not called.)

## Regression detection

Change the prompt, the model, the retriever or the index, run again, and compare:

```bash
npx behavtest run rag.suite.ts --repeat 5 --label new-retriever
npx behavtest compare
```

Retrieval regressions show up in the `retrieval` scorer before they reach the answer: the expected document drops out of the top k. Grounding regressions (an answer that adds claims the documents don't support) show up in `faithfulness`. Custom checks like `mentionsFiveDays` are plain functions. `behavtest show <run> <case>` prints the recorded steps, with what was retrieved and in which order.

## CI/CD

The Python variant needs the endpoint started in the job before BehavTest runs (see [HTTP services](/integrations/http/)); the JavaScript variant runs directly with `npm ci` and the [GitHub Action](/docs/github-action/) or `npx behavtest run` in any CI.

## Limitations

- BehavTest has no LangChain callback handler: steps are what your code reports (a `retrieval` step in the response, or `tracer()` in a code suite).
- Python `Document` objects must be mapped to `{ id, text }`; LangChain.js documents are read directly.
- LangGraph agents and multi-turn state are testable only through what your endpoint or function returns for one request.

## Links

- BehavTest: [RAG](/docs/rag/), [traces](/docs/traces/), [code suites](/docs/code-suites/), [HTTP services](/integrations/http/)
- LangChain: [documentation](https://docs.langchain.com)
- [BehavTest on GitHub](https://github.com/dhrumilbhut/behavtest) · [BehavTest on npm](https://www.npmjs.com/package/behavtest)
