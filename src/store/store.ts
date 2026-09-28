import type { AttemptRecord, RunRecord, RunStatus, RunSummary } from "../core/types.js";

export type NewRun = Omit<RunRecord, "finishedAt" | "summary" | "status">;

/** Identifies one verdict: a scorer's score on one attempt of a case in a run. */
export interface LabelKey {
  runId: string;
  caseId: string;
  attempt: number;
  scorer: string;
}

/** A matrix: runs of one suite, one per variant, started together. */
export interface MatrixSummary {
  matrixId: string;
  suiteName: string;
  /** When its first run started. */
  startedAt: string;
  /** Variant names in the order they ran, with their run ids. */
  variants: Array<{ variant: string; runId: string; status: RunRecord["status"] }>;
}

/** Your own pass/fail on a judged answer, used to calibrate the judge. */
export interface StoredLabel extends LabelKey {
  label: "pass" | "fail";
  note?: string;
  updatedAt: string;
}

/**
 * Persistence contract. SQLite is the default implementation; the interface
 * keeps a future Postgres store a port rather than a redesign.
 */
export interface Store {
  /** Creates the run with status "running". */
  createRun(run: NewRun): void;
  /** Persists one attempt and its scores atomically. */
  saveAttempt(runId: string, attempt: AttemptRecord): void;
  finishRun(runId: string, status: RunStatus, finishedAt: string, summary: RunSummary): void;
  /** Accepts a full run id or a unique prefix. Throws `ConfigError` if ambiguous. */
  getRun(idOrPrefix: string): RunRecord | undefined;
  listRuns(opts?: { suiteName?: string; limit?: number }): RunRecord[];
  /** Matrices, newest first. Optional: stores without matrix support skip `regrade matrix`. */
  listMatrices?(opts?: { suiteName?: string; limit?: number }): MatrixSummary[];
  /** One matrix by id or unique prefix. Throws `ConfigError` if ambiguous. */
  getMatrix?(idOrPrefix: string): MatrixSummary | undefined;
  /** Attempts in insertion order. Traces are loaded only when asked for (`traces: true`); `caseId` limits them to one case. */
  getAttempts(runId: string, opts?: { traces?: boolean; caseId?: string }): AttemptRecord[];
  /** Save (or replace) your label on one judged verdict. Optional: stores without labels skip calibration from storage. */
  setLabel?(label: StoredLabel): void;
  /** Remove a label; true when one existed. */
  deleteLabel?(key: LabelKey): boolean;
  /** Stored labels, optionally for one run. */
  listLabels?(opts?: { runId?: string }): StoredLabel[];
  close(): void;
}
