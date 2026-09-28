// The example RAG pipeline over HTTP: POST { "input": "question" } -> { "output", "steps" }.
// Run it with:  node examples/rag/server.mjs      (PORT, default 4100)
// Choose a behaviour per request with ?mode=healthy|degraded|hallucinate (default healthy).
import { createServer } from "node:http";
import { answer } from "./rag.mjs";

const port = Number(process.env.PORT ?? 4100);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method !== "POST" || url.pathname !== "/rag") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let question = "";
    try {
      question = String(JSON.parse(body).input ?? "");
    } catch {}
    const result = answer(question, { mode: url.searchParams.get("mode") ?? "healthy" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
}).listen(port, () => console.log(`example RAG pipeline listening on http://localhost:${port}/rag`));
