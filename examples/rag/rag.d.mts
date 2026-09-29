// Types for rag.mjs, so TypeScript code (BehavTest's own tests, or your code suite) can import it.
export interface PolicyDoc {
  id: string;
  title: string;
  text: string;
}
export interface RetrievedDoc {
  id: string;
  text: string;
  score: number;
}
export type Mode = "healthy" | "degraded" | "hallucinate";
export interface TraceStep {
  kind: "retrieval" | "llm";
  name: string;
  startOffsetMs: number;
  durationMs: number;
  input: unknown;
  output: unknown;
}

export declare const DOCS: PolicyDoc[];
export declare function retrieve(query: string, k?: number): RetrievedDoc[];
export declare function answer(question: string, opts?: { mode?: Mode; k?: number }): { output: string; steps: TraceStep[] };
