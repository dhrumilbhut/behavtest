import { z } from "zod";
import { calibrate, type Label } from "../calibration/calibrate.js";
import { ConfigError } from "../core/errors.js";
import type { RunRecord } from "../core/types.js";
import { reportData } from "../report/html/render.js";
import { buildRunReport } from "../report/model.js";
import { compareRuns } from "../stats/compare.js";
import { wilsonInterval, type Proportion } from "../stats/wilson.js";
import type { LabelKey, StoredLabel, Store } from "../store/store.js";

/** The API's shapes carry this version; a breaking change bumps it and the URL prefix. */
export const API_VERSION = 1;
export const API_PREFIX = "/api/v1";

export interface ApiRequest {
  method: string;
  /** Path after the API prefix, e.g. "/runs/abc". */
  path: string;
  query: URLSearchParams;
  /** Parsed JSON body (PUT only). */
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  json: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TREND_LIMIT = 100;
const RUNS_LIMIT_MAX = 1000;
const SUITE_SCAN = 10_000;

/** A run's attempt pass rate (errored attempts have no verdict), with its Wilson interval. */
function attemptRate(run: RunRecord): Proportion | null {
  const a = run.summary?.attempts;
  if (!a) return null;
  const scored = a.passed + a.failed;
  return scored > 0 ? wilsonInterval(a.passed, scored) : null;
}

/** A run as listed: everything but the pipeline config, plus its attempt pass rate. */
function runRow(run: RunRecord) {
  const { pipeline: _pipeline, ...rest } = run;
  return { ...rest, attemptRate: attemptRate(run) };
}

function requireRun(store: Store, ref: string): RunRecord {
  let run: RunRecord | undefined;
  try {
    run = store.getRun(ref);
  } catch (err) {
    if (err instanceof ConfigError) throw new ApiError(400, err.message); // an ambiguous prefix
    throw err;
  }
  if (!run) throw new ApiError(404, `No run matching "${ref}".`);
  return run;
}

function intParam(q: URLSearchParams, name: string, min: number, max: number): number | undefined {
  const raw = q.get(name);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(400, `"${name}" must be an integer between ${min} and ${max}.`);
  return n;
}

function need(q: URLSearchParams, name: string): string {
  const v = q.get(name);
  if (!v) throw new ApiError(400, `Missing query parameter "${name}".`);
  return v;
}

const labelBody = z.strictObject({
  run: z.string().min(1).max(200),
  case: z.string().min(1).max(1000),
  attempt: z.number().int().min(1).max(1000),
  scorer: z.string().min(1).max(200),
  label: z.enum(["pass", "fail"]),
  note: z.string().max(2000).optional(),
});

function labelsOf(store: Store): Required<Pick<Store, "setLabel" | "deleteLabel" | "listLabels">> {
  if (!store.setLabel || !store.deleteLabel || !store.listLabels) throw new ApiError(501, "This results store does not keep labels.");
  return { setLabel: store.setLabel.bind(store), deleteLabel: store.deleteLabel.bind(store), listLabels: store.listLabels.bind(store) };
}

/** The labelled verdict must exist and come from a judge, so labels always match something calibrate can use. */
function requireJudgedVerdict(store: Store, runId: string, caseId: string, attempt: number, scorer: string): void {
  const a = store.getAttempts(runId, { caseId }).find((x) => x.attempt === attempt);
  if (!a) throw new ApiError(404, `Run ${runId.slice(0, 8)} has no attempt ${attempt} of case "${caseId}".`);
  const s = a.scores.find((x) => x.scorerName === scorer);
  if (!s) throw new ApiError(404, `Attempt ${attempt} of case "${caseId}" has no score from "${scorer}".`);
  if (typeof s.metadata?.judge !== "string" || s.error) throw new ApiError(400, `"${scorer}" is not a judge verdict that can be labelled.`);
}

const toLabel = (l: StoredLabel): Label => ({ run: l.runId, case: l.caseId, attempt: l.attempt, scorer: l.scorer, label: l.label, ...(l.note ? { note: l.note } : {}) });

/** Labelled verdicts where the judge and you disagree: the ones worth reading first. */
function disagreements(store: Store, labels: readonly StoredLabel[]) {
  const byRun = new Map<string, Map<string, boolean>>();
  const out: Array<LabelKey & { label: "pass" | "fail"; judgePass: boolean }> = [];
  for (const l of labels) {
    let verdicts = byRun.get(l.runId);
    if (!verdicts) {
      verdicts = new Map();
      for (const a of store.getAttempts(l.runId)) {
        for (const s of a.scores) if (!s.error) verdicts.set(JSON.stringify([a.caseId, a.attempt, s.scorerName]), s.pass);
      }
      byRun.set(l.runId, verdicts);
    }
    const judgePass = verdicts.get(JSON.stringify([l.caseId, l.attempt, l.scorer]));
    if (judgePass !== undefined && judgePass !== (l.label === "pass")) {
      out.push({ runId: l.runId, caseId: l.caseId, attempt: l.attempt, scorer: l.scorer, label: l.label, judgePass });
    }
  }
  return out;
}

export interface ApiContext {
  store: Store;
  version: string;
}

/** Route one API request. Throws ApiError for client errors; anything else is a server error. */
export function handleApi(ctx: ApiContext, req: ApiRequest): ApiResponse {
  const { store } = ctx;
  let parts: string[];
  try {
    parts = req.path.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  } catch {
    throw new ApiError(400, "Malformed URL encoding in the path.");
  }
  const route = `${req.method} /${parts.map((p, i) => (i % 2 === 1 ? ":" : p)).join("/")}`;
  const ok = (json: unknown): ApiResponse => ({ status: 200, json });

  switch (route) {
    case "GET /": {
      return ok({ apiVersion: API_VERSION, version: ctx.version });
    }
    case "GET /suites": {
      const runs = store.listRuns({ limit: SUITE_SCAN });
      const suites = new Map<string, { suiteName: string; runs: number; latest: ReturnType<typeof runRow> }>();
      for (const r of runs) {
        // listRuns is newest first, so the first run seen for a suite is its latest
        const s = suites.get(r.suiteName);
        if (s) s.runs++;
        else suites.set(r.suiteName, { suiteName: r.suiteName, runs: 1, latest: runRow(r) });
      }
      return ok({ suites: [...suites.values()] });
    }
    case "GET /runs": {
      const suite = req.query.get("suite") || undefined;
      const limit = intParam(req.query, "limit", 1, RUNS_LIMIT_MAX) ?? 200;
      return ok({ runs: store.listRuns({ suiteName: suite, limit }).map(runRow) });
    }
    case "GET /runs/:": {
      const run = requireRun(store, parts[1] as string);
      const attempts = store.getAttempts(run.runId);
      const data = reportData({ report: buildRunReport(run, attempts), version: ctx.version, traces: false });
      const labels = store.listLabels ? store.listLabels({ runId: run.runId }) : [];
      return ok({ ...data, labels });
    }
    case "GET /runs/:/cases/:": {
      const run = requireRun(store, parts[1] as string);
      const caseId = parts[3] as string;
      const attempts = store.getAttempts(run.runId, { traces: true, caseId });
      if (attempts.length === 0) throw new ApiError(404, `Run ${run.runId.slice(0, 8)} has no case "${caseId}".`);
      const data = reportData({ report: buildRunReport(run, attempts), version: ctx.version });
      return ok({ case: data.cases[0] });
    }
    case "GET /compare": {
      const base = requireRun(store, need(req.query, "base"));
      const head = requireRun(store, need(req.query, "head"));
      const comparison = compareRuns({
        base: { run: base, attempts: store.getAttempts(base.runId) },
        head: { run: head, attempts: store.getAttempts(head.runId) },
      });
      return ok({ comparison });
    }
    case "GET /trend": {
      const suite = need(req.query, "suite");
      const limit = intParam(req.query, "limit", 2, 1000) ?? TREND_LIMIT;
      const points = store
        .listRuns({ suiteName: suite, limit })
        .filter((r) => r.status !== "running" && r.summary)
        .reverse() // oldest first
        .map((r) => ({
          runId: r.runId,
          startedAt: r.startedAt,
          label: r.label,
          gitSha: r.gitSha,
          status: r.status,
          cases: r.summary!.cases,
          attemptRate: attemptRate(r),
        }));
      return ok({ suiteName: suite, points });
    }
    case "GET /calibration": {
      const { listLabels } = labelsOf(store);
      const runRef = req.query.get("run");
      const labels = listLabels(runRef ? { runId: requireRun(store, runRef).runId } : undefined);
      return ok({ calibration: calibrate(store, labels.map(toLabel)), disagreements: disagreements(store, labels) });
    }
    case "GET /labels": {
      const { listLabels } = labelsOf(store);
      const runRef = req.query.get("run");
      return ok({ labels: listLabels(runRef ? { runId: requireRun(store, runRef).runId } : undefined) });
    }
    case "PUT /labels": {
      const { setLabel } = labelsOf(store);
      const parsed = labelBody.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, `Invalid label: ${parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")}`);
      const b = parsed.data;
      const run = requireRun(store, b.run);
      requireJudgedVerdict(store, run.runId, b.case, b.attempt, b.scorer);
      const label: StoredLabel = {
        runId: run.runId,
        caseId: b.case,
        attempt: b.attempt,
        scorer: b.scorer,
        label: b.label,
        ...(b.note ? { note: b.note } : {}),
        updatedAt: new Date().toISOString(),
      };
      setLabel(label);
      return ok({ label });
    }
    case "DELETE /labels": {
      const { deleteLabel } = labelsOf(store);
      const run = requireRun(store, need(req.query, "run"));
      const attempt = intParam(req.query, "attempt", 1, 1000);
      if (attempt === undefined) throw new ApiError(400, 'Missing query parameter "attempt".');
      const deleted = deleteLabel({ runId: run.runId, caseId: need(req.query, "case"), attempt, scorer: need(req.query, "scorer") });
      return ok({ deleted });
    }
  }
  const known = ["/suites", "/runs", "/runs/:", "/runs/:/cases/:", "/compare", "/trend", "/calibration", "/labels"];
  const shape = route.slice(route.indexOf(" ") + 1);
  if (known.includes(shape) || shape === "/") throw new ApiError(405, `${req.method} is not allowed here.`);
  throw new ApiError(404, `No API route ${req.method} ${API_PREFIX}${req.path}.`);
}
