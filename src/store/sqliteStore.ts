import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { ConfigError, errorMessage } from "../core/errors.js";
import type {
  AttemptRecord,
  CaseInput,
  RunRecord,
  RunStatus,
  RunSummary,
  ScoreRecord,
  TraceStep,
  Usage,
} from "../core/types.js";
import { LATEST_SCHEMA_VERSION, migrations } from "./migrations.js";
import type { LabelKey, MatrixSummary, NewRun, Store, StoredLabel } from "./store.js";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);

export class SqliteStore implements Store {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") {
      try {
        mkdirSync(dirname(path), { recursive: true });
      } catch (err) {
        throw new ConfigError(`Cannot create directory for database "${path}": ${errorMessage(err)}`);
      }
    }
    try {
      this.db = new Database(path);
    } catch (err) {
      throw new ConfigError(`Cannot open database "${path}": ${errorMessage(err)}`);
    }
    this.db.pragma("foreign_keys = ON");
    if (path !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.migrate(path);
  }

  private migrate(path: string): void {
    const current = Number(this.db.pragma("user_version", { simple: true }));
    if (current > LATEST_SCHEMA_VERSION) {
      this.db.close();
      throw new ConfigError(
        `Database "${path}" has schema version ${current}, newer than this BehavTest supports (${LATEST_SCHEMA_VERSION}). Upgrade BehavTest.`,
      );
    }
    for (const m of migrations.filter((x) => x.version > current)) {
      this.db.transaction(() => {
        this.db.exec(m.sql);
        this.db.pragma(`user_version = ${m.version}`);
      })();
    }
  }

  schemaVersion(): number {
    return Number(this.db.pragma("user_version", { simple: true }));
  }

  createRun(run: NewRun): void {
    this.db
      .prepare(
        `INSERT INTO runs (run_id, suite_name, suite_hash, started_at, status, regrade_version,
                           git_sha, git_dirty, label, pipeline_json, matrix_id, variant)
         VALUES (@runId, @suiteName, @suiteHash, @startedAt, 'running', @behavtestVersion,
                 @gitSha, @gitDirty, @label, @pipeline, @matrixId, @variant)`,
      )
      .run({
        runId: run.runId,
        suiteName: run.suiteName,
        suiteHash: run.suiteHash,
        startedAt: run.startedAt,
        behavtestVersion: run.behavtestVersion,
        gitSha: run.gitSha,
        gitDirty: run.gitDirty === null ? null : run.gitDirty ? 1 : 0,
        label: run.label,
        pipeline: JSON.stringify(run.pipeline),
        matrixId: run.matrixId ?? null,
        variant: run.variant ?? null,
      });
  }

  saveAttempt(runId: string, a: AttemptRecord): void {
    const insertResult = this.db.prepare(
      `INSERT INTO results (run_id, case_id, attempt, case_hash, input_json, expected, tags_json, output,
                            latency_ms, cost_usd, input_tokens, output_tokens, cached_input_tokens,
                            cache_write_tokens, cache_write_1h_tokens, reasoning_tokens,
                            status, error, completed_at)
       VALUES (@runId, @caseId, @attempt, @caseHash, @input, @expected, @tags, @output,
               @latencyMs, @costUsd, @inputTokens, @outputTokens, @cachedInputTokens,
               @cacheWriteTokens, @cacheWrite1hTokens, @reasoningTokens,
               @status, @error, @completedAt)`,
    );
    const insertScore = this.db.prepare(
      `INSERT INTO scores (result_id, scorer_name, pass, value, reasoning, cost_usd, error, config_json, metadata_json)
       VALUES (@resultId, @scorerName, @pass, @value, @reasoning, @costUsd, @error, @config, @metadata)`,
    );

    const insertTrace = this.db.prepare(`INSERT INTO traces (result_id, trace_json) VALUES (?, ?)`);

    this.db.transaction(() => {
      const info = insertResult.run({
        runId,
        caseId: a.caseId,
        attempt: a.attempt,
        caseHash: a.caseHash,
        input: JSON.stringify(a.input),
        expected: a.expected ?? null,
        tags: a.tags ? JSON.stringify(a.tags) : null,
        output: a.output,
        latencyMs: a.latencyMs,
        costUsd: a.costUsd,
        inputTokens: a.usage?.inputTokens ?? null,
        outputTokens: a.usage?.outputTokens ?? null,
        cachedInputTokens: a.usage?.cachedInputTokens ?? null,
        cacheWriteTokens: a.usage?.cacheWriteTokens ?? null,
        cacheWrite1hTokens: a.usage?.cacheWrite1hTokens ?? null,
        reasoningTokens: a.usage?.reasoningTokens ?? null,
        status: a.status,
        error: a.error ?? null,
        completedAt: a.completedAt,
      });
      const resultId = Number(info.lastInsertRowid);
      if (a.trace) insertTrace.run(resultId, JSON.stringify(a.trace));
      for (const s of a.scores) {
        insertScore.run({
          resultId,
          scorerName: s.scorerName,
          pass: s.pass ? 1 : 0,
          value: s.value,
          reasoning: s.reasoning ?? null,
          costUsd: s.costUsd ?? null,
          error: s.error ?? null,
          config: s.config ? JSON.stringify(s.config) : null,
          metadata: s.metadata ? JSON.stringify(s.metadata) : null,
        });
      }
    })();
  }

  /** Insert a complete run (e.g. from a run file) atomically: all of it or nothing. */
  importRun(run: RunRecord, attempts: readonly AttemptRecord[], summary: RunSummary): void {
    this.db.transaction(() => {
      this.createRun(run);
      for (const a of attempts) this.saveAttempt(run.runId, a);
      if (run.status !== "running") this.finishRun(run.runId, run.status, run.finishedAt ?? run.startedAt, summary);
    })();
  }

  finishRun(runId: string, status: RunStatus, finishedAt: string, summary: RunSummary): void {
    this.db
      .prepare(`UPDATE runs SET status = ?, finished_at = ?, summary_json = ? WHERE run_id = ?`)
      .run(status, finishedAt, JSON.stringify(summary), runId);
  }

  getRun(idOrPrefix: string): RunRecord | undefined {
    const rows = this.db
      .prepare(`SELECT * FROM runs WHERE substr(run_id, 1, ?) = ? ORDER BY started_at DESC LIMIT 2`)
      .all(idOrPrefix.length, idOrPrefix) as Row[];
    if (rows.length > 1) {
      throw new ConfigError(`Run id prefix "${idOrPrefix}" is ambiguous; use more characters.`);
    }
    return rows[0] ? mapRun(rows[0]) : undefined;
  }

  listRuns(opts: { suiteName?: string; limit?: number } = {}): RunRecord[] {
    const limit = opts.limit ?? 20;
    const rows = (
      opts.suiteName
        ? this.db
            .prepare(`SELECT * FROM runs WHERE suite_name = ? ORDER BY started_at DESC LIMIT ?`)
            .all(opts.suiteName, limit)
        : this.db.prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`).all(limit)
    ) as Row[];
    return rows.map(mapRun);
  }

  listMatrices(opts: { suiteName?: string; limit?: number } = {}): MatrixSummary[] {
    const limit = opts.limit ?? 20;
    const ids = (
      opts.suiteName
        ? this.db
            .prepare(`SELECT matrix_id, MIN(started_at) AS s FROM runs WHERE matrix_id IS NOT NULL AND suite_name = ? GROUP BY matrix_id ORDER BY s DESC LIMIT ?`)
            .all(opts.suiteName, limit)
        : this.db.prepare(`SELECT matrix_id, MIN(started_at) AS s FROM runs WHERE matrix_id IS NOT NULL GROUP BY matrix_id ORDER BY s DESC LIMIT ?`).all(limit)
    ) as Row[];
    return ids.map((r) => this.matrixOf(String(r.matrix_id)));
  }

  getMatrix(idOrPrefix: string): MatrixSummary | undefined {
    const ids = this.db
      .prepare(`SELECT DISTINCT matrix_id FROM runs WHERE matrix_id IS NOT NULL AND substr(matrix_id, 1, ?) = ? LIMIT 2`)
      .all(idOrPrefix.length, idOrPrefix) as Row[];
    if (ids.length > 1) throw new ConfigError(`Matrix id prefix "${idOrPrefix}" is ambiguous; use more characters.`);
    return ids[0] ? this.matrixOf(String(ids[0].matrix_id)) : undefined;
  }

  private matrixOf(matrixId: string): MatrixSummary {
    const rows = this.db.prepare(`SELECT run_id, suite_name, started_at, status, variant FROM runs WHERE matrix_id = ? ORDER BY started_at, rowid`).all(matrixId) as Row[];
    return {
      matrixId,
      suiteName: String(rows[0]?.suite_name),
      startedAt: String(rows[0]?.started_at),
      variants: rows.map((r) => ({ variant: String(r.variant), runId: String(r.run_id), status: r.status as RunStatus })),
    };
  }

  getAttempts(runId: string, opts: { traces?: boolean; caseId?: string } = {}): AttemptRecord[] {
    const one = opts.caseId !== undefined;
    const caseFilter = one ? " AND case_id = ?" : "";
    const params = one ? [runId, opts.caseId] : [runId];
    const results = this.db
      .prepare(`SELECT * FROM results WHERE run_id = ?${caseFilter} ORDER BY result_id`)
      .all(...params) as Row[];
    const scoreStmt = this.db.prepare(`SELECT * FROM scores WHERE result_id = ? ORDER BY score_id`);
    const traces = new Map<unknown, string>();
    if (opts.traces) {
      const rows = this.db
        .prepare(`SELECT t.result_id, t.trace_json FROM traces t JOIN results r USING (result_id) WHERE r.run_id = ?${one ? " AND r.case_id = ?" : ""}`)
        .all(...params) as Row[];
      for (const t of rows) traces.set(t.result_id, String(t.trace_json));
    }
    return results.map((r) => {
      const scores = (scoreStmt.all(r.result_id) as Row[]).map(mapScore);
      const usage: Usage = {};
      if (typeof r.input_tokens === "number") usage.inputTokens = r.input_tokens;
      if (typeof r.output_tokens === "number") usage.outputTokens = r.output_tokens;
      if (typeof r.cached_input_tokens === "number") usage.cachedInputTokens = r.cached_input_tokens;
      if (typeof r.cache_write_tokens === "number") usage.cacheWriteTokens = r.cache_write_tokens;
      if (typeof r.cache_write_1h_tokens === "number") usage.cacheWrite1hTokens = r.cache_write_1h_tokens;
      if (typeof r.reasoning_tokens === "number") usage.reasoningTokens = r.reasoning_tokens;
      const attempt: AttemptRecord = {
        caseId: String(r.case_id),
        attempt: Number(r.attempt),
        caseHash: String(r.case_hash),
        input: JSON.parse(String(r.input_json)) as CaseInput,
        expected: str(r.expected) ?? undefined,
        tags: r.tags_json ? (JSON.parse(String(r.tags_json)) as string[]) : undefined,
        output: str(r.output),
        latencyMs: numOrNull(r.latency_ms),
        costUsd: numOrNull(r.cost_usd),
        usage: Object.keys(usage).length > 0 ? usage : undefined,
        status: r.status as AttemptRecord["status"],
        error: str(r.error) ?? undefined,
        completedAt: String(r.completed_at),
        scores,
      };
      const trace = traces.get(r.result_id);
      if (trace !== undefined) attempt.trace = JSON.parse(trace) as TraceStep[];
      return attempt;
    });
  }

  setLabel(l: StoredLabel): void {
    this.db
      .prepare(
        `INSERT INTO labels (run_id, case_id, attempt, scorer, label, note, updated_at)
         VALUES (@runId, @caseId, @attempt, @scorer, @label, @note, @updatedAt)
         ON CONFLICT (run_id, case_id, attempt, scorer) DO UPDATE SET label = excluded.label, note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run({ ...l, note: l.note ?? null });
  }

  deleteLabel(k: LabelKey): boolean {
    return (
      this.db
        .prepare(`DELETE FROM labels WHERE run_id = ? AND case_id = ? AND attempt = ? AND scorer = ?`)
        .run(k.runId, k.caseId, k.attempt, k.scorer).changes > 0
    );
  }

  listLabels(opts: { runId?: string } = {}): StoredLabel[] {
    const rows = (
      opts.runId
        ? this.db.prepare(`SELECT * FROM labels WHERE run_id = ? ORDER BY label_id`).all(opts.runId)
        : this.db.prepare(`SELECT * FROM labels ORDER BY label_id`).all()
    ) as Row[];
    return rows.map((r) => {
      const label: StoredLabel = {
        runId: String(r.run_id),
        caseId: String(r.case_id),
        attempt: Number(r.attempt),
        scorer: String(r.scorer),
        label: r.label === "pass" ? "pass" : "fail",
        updatedAt: String(r.updated_at),
      };
      if (typeof r.note === "string") label.note = r.note;
      return label;
    });
  }

  close(): void {
    this.db.close();
  }
}

function mapRun(r: Row): RunRecord {
  return {
    runId: String(r.run_id),
    suiteName: String(r.suite_name),
    suiteHash: String(r.suite_hash),
    startedAt: String(r.started_at),
    finishedAt: str(r.finished_at),
    status: r.status as RunStatus,
    // the column keeps the name from when the project was called Regrade: renaming it would need a migration
    behavtestVersion: String(r.regrade_version),
    gitSha: str(r.git_sha),
    gitDirty: r.git_dirty === null || r.git_dirty === undefined ? null : Number(r.git_dirty) === 1,
    label: str(r.label),
    pipeline: JSON.parse(String(r.pipeline_json)) as Record<string, unknown>,
    summary: r.summary_json ? (JSON.parse(String(r.summary_json)) as RunSummary) : null,
    // only on matrix runs, so plain runs keep their exact shape
    ...(r.matrix_id && r.variant ? { matrixId: String(r.matrix_id), variant: String(r.variant) } : {}),
  };
}

function mapScore(r: Row): ScoreRecord {
  return {
    scorerName: String(r.scorer_name),
    pass: Number(r.pass) === 1,
    value: numOrNull(r.value),
    reasoning: str(r.reasoning) ?? undefined,
    costUsd: numOrNull(r.cost_usd),
    error: str(r.error) ?? undefined,
    config: r.config_json ? (JSON.parse(String(r.config_json)) as Record<string, unknown>) : undefined,
    metadata: r.metadata_json ? (JSON.parse(String(r.metadata_json)) as Record<string, unknown>) : undefined,
  };
}
