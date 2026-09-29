// A small, deterministic retrieval-augmented pipeline for trying BehavTest's RAG scorers.
// A fictional store's policy documents, a keyword retriever, and an answer built from the best
// document. No model and no API key: the same question always gives the same answer.
//
// Modes (to see what BehavTest catches):
//   healthy      retrieves the right policy and answers from it
//   degraded     retrieval is broken: the right document is missing, the answer comes from another
//   hallucinate  retrieval is fine, but the answer adds a claim no document supports

export const DOCS = [
  { id: "returns", title: "Returns", text: "Items can be returned within 30 days of delivery for a full refund. Items must be unworn and have their original tags. Returns after 30 days are not accepted." },
  { id: "refunds", title: "Refunds", text: "Refunds go back to the original payment method. A refund is issued within 5 business days of the return arriving at our warehouse." },
  { id: "exchanges", title: "Exchanges", text: "You can exchange an item for a different size or colour within 30 days. Exchanges ship free of charge." },
  { id: "final-sale", title: "Sale items", text: "Items bought on clearance sale are final sale. Final sale items cannot be returned or exchanged." },
  { id: "damaged", title: "Damaged or wrong items", text: "If an item arrives damaged or you received the wrong item, send us a photo within 48 hours of delivery. We send a replacement at no cost." },
  { id: "shipping-standard", title: "Standard shipping", text: "Standard shipping takes 3 to 5 business days. Standard shipping is free on orders over 50 dollars." },
  { id: "shipping-express", title: "Express shipping", text: "Express shipping delivers the next business day. Order before 2 pm to ship the same day. Express shipping costs 15 dollars." },
  { id: "international", title: "International shipping", text: "We ship to Canada, the United Kingdom and the European Union. International delivery takes 7 to 14 business days. Import duties are paid by the customer." },
  { id: "tracking", title: "Order tracking", text: "A tracking link is emailed when your order ships. You can also track an order from the Orders page of your account." },
  { id: "cancellations", title: "Cancelling an order", text: "Orders can be cancelled within 1 hour of being placed. After 1 hour the order is packed and cannot be cancelled, but it can be returned." },
  { id: "warranty", title: "Warranty", text: "Jackets and outerwear have a 2 year warranty against manufacturing defects. The warranty does not cover normal wear and tear." },
  { id: "price-match", title: "Price adjustments", text: "If an item's price drops within 14 days of purchase, we refund the difference. Contact support with your order number." },
  { id: "gift-cards", title: "Gift cards", text: "Gift cards never expire. Gift cards cannot be exchanged for cash or refunded." },
  { id: "loyalty", title: "Loyalty points", text: "Members earn 1 point for every dollar spent. 100 points can be redeemed for a 5 dollar discount." },
  { id: "support-hours", title: "Customer support", text: "Customer support is available by chat and email from 8 am to 8 pm, Monday to Saturday." },
];

const STOP = new Set("a an and are as at be by can do does for from get how i if in is it my of on or our the this to was what when where which who will with you your".split(" "));
const tokens = (text) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((t) => t && !STOP.has(t)).map(stem);
/** A crude stemmer, enough for this corpus: cancellations, cancelled, cancel -> cancel. */
function stem(t) {
  if (t.length <= 4) return t;
  const s = t.replace(/(ations|ation|ing|ed|es|s)$/, "");
  return s.endsWith("ll") ? s.slice(0, -1) : s;
}
const docTokens = DOCS.map((d) => ({ doc: d, title: tokens(d.title), body: tokens(d.text) }));
const idf = new Map();
for (const { title, body } of docTokens) for (const t of new Set([...title, ...body])) idf.set(t, (idf.get(t) ?? 0) + 1);
for (const [t, n] of idf) idf.set(t, Math.log(1 + DOCS.length / n));

/** Top-k documents for a query, with a relevance score (keyword overlap weighted by rarity; title words count double). */
export function retrieve(query, k = 3) {
  const q = new Set(tokens(query));
  return docTokens
    .map(({ doc, title, body }) => {
      let score = 0;
      for (const t of q) score += (idf.get(t) ?? 0) * (2 * title.filter((x) => x === t).length + body.filter((x) => x === t).length);
      return { id: doc.id, text: doc.text, score: Math.round(score * 100) / 100 };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, k);
}

/** The two sentences of a document that share the most words with the question, in document order. */
function bestSentences(question, text) {
  const q = new Set(tokens(question));
  const sentences = (text.match(/[^.]+\./g) ?? [text]).map((s, i) => ({ s: s.trim(), i, score: tokens(s).filter((t) => q.has(t)).length }));
  return [...sentences]
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 2)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join(" ");
}

/**
 * Answer a question. Returns `{ output, steps }`: `steps` is the trace BehavTest stores and scores (a
 * `retrieval` step whose output is the retrieved documents, then an `llm` step that writes the answer).
 */
export function answer(question, { mode = "healthy", k = 3 } = {}) {
  let docs = retrieve(question, k + 1);
  if (mode === "degraded") docs = docs.slice(1); // the best match goes missing
  docs = docs.slice(0, k);
  let output = docs.length === 0 ? "I don't know." : bestSentences(question, docs[0].text);
  if (mode === "hallucinate" && docs.length > 0) output += " You also get a free 20 dollar gift card with every return.";
  return {
    output,
    steps: [
      { kind: "retrieval", name: "search-policies", startOffsetMs: 0, durationMs: 4, input: { query: question, k }, output: docs },
      { kind: "llm", name: "compose-answer", startOffsetMs: 4, durationMs: 12, input: { question, context: docs.map((d) => d.id) }, output },
    ],
  };
}
