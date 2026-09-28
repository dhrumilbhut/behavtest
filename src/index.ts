/**
 * Public library surface. The adapter and scorer contracts (`types.ts`) are the
 * stable core: change them only additively.
 */
import { defaultRegistry } from "./core/registry.js";
import { registerBuiltins } from "./builtins.js";

registerBuiltins(defaultRegistry);

export * from "./core/types.js";
export { ConfigError, AdapterError, JudgeError, RegradeError } from "./core/errors.js";
export { Registry, defaultRegistry, registerAdapter, registerScorer } from "./core/registry.js";
export { createRegistry, registerBuiltins } from "./builtins.js";
export { loadSuite, parseSuite, checkSuite, testSuiteSchema } from "./core/testSuite.js";
export { runSuite, plannedAttempts, DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_MS } from "./core/runner.js";
export { runMatrix, resolveVariant, selectVariants, mergeConfig } from "./core/variants.js";
export type { MatrixRunOptions, MatrixOutcome } from "./core/variants.js";
export { buildMatrix, loadMatrix, pickMatrix } from "./matrix/matrix.js";
export type { MatrixReport, MatrixVariant, MatrixCell, LoadedMatrixRun } from "./matrix/matrix.js";
export { renderMatrixConsole, renderMatrixMarkdown } from "./matrix/render.js";
export { renderMatrixHtml } from "./matrix/html.js";
export type { RunOptions, RunOutcome, RunOverrides } from "./core/runner.js";
export { caseVerdict, groupCases, summarize } from "./core/verdict.js";
export type { CaseOutcome } from "./core/verdict.js";
export { withRetry } from "./core/retry.js";
export { SqliteStore } from "./store/sqliteStore.js";
export type { Store, NewRun, LabelKey, StoredLabel, MatrixSummary } from "./store/store.js";
export { buildRunFile, parseRunFile, readRunFile, serializeRunFile, writeRunFile, RUN_FILE_KIND, RUN_FILE_VERSION } from "./store/runFile.js";
export type { RunFile, LoadedRun } from "./store/runFile.js";
export { computeCost, defaultPrices, mergePrices } from "./pricing/cost.js";
export type { PriceTable, PriceEntry } from "./pricing/cost.js";
export { buildRunReport } from "./report/model.js";
export type { RunReport } from "./report/model.js";
export type { RunReporter, RunStartInfo } from "./report/types.js";
export { exactMatch } from "./scorers/exactMatch.js";
export { llmJudge } from "./scorers/llmJudge.js";
export { latencyCost } from "./scorers/latencyCost.js";
export { toolCalled, maxSteps } from "./scorers/traceScorers.js";
export { retrieval } from "./scorers/retrieval.js";
export { faithfulness, contextRelevance } from "./scorers/ragJudge.js";
export { tracer, prepareTrace, flattenTrace, retrievedDocs, TRACE_TEXT_LIMIT, TRACE_STEP_LIMIT } from "./core/trace.js";
export type { Tracer, RetrievedDoc } from "./core/trace.js";
export { httpAdapter } from "./adapters/httpAdapter.js";
export { openaiAdapter } from "./adapters/openaiAdapter.js";
export { anthropicAdapter } from "./adapters/anthropicAdapter.js";
export { compareRuns, regressionGate, CASE_ALPHA, OVERALL_ALPHA } from "./stats/compare.js";
export type { Comparison, CaseComparison, CaseChange, OverallVerdict, GateResult, RunMeta } from "./stats/compare.js";
export { wilsonInterval } from "./stats/wilson.js";
export { cohensKappa, confusionOf, kappaInterval } from "./stats/agreement.js";
export type { Confusion, LabelPair } from "./stats/agreement.js";
export { calibrate, calibrationGate, parseLabels, MIN_LABELS } from "./calibration/calibrate.js";
export type { CalibrationReport, CalibrationGroup, CalibrationGate, Label } from "./calibration/calibrate.js";
export type { Proportion } from "./stats/wilson.js";
export { fisherExact } from "./stats/fisher.js";
export { stratifiedPermutationTest, stratifiedBootstrapInterval } from "./stats/bootstrap.js";
export type { PairedCase } from "./stats/bootstrap.js";
export { renderHtmlReport, reportData } from "./report/html/render.js";
export type { ReportData } from "./report/html/render.js";
export { startDashboard, dashboardHandler } from "./serve/server.js";
export type { DashboardServer, DashboardServerOptions } from "./serve/server.js";
export { handleApi, ApiError, API_VERSION } from "./serve/api.js";
export { renderRunMarkdown, renderCompareMarkdown } from "./report/markdown.js";
export { renderComparison } from "./report/compareConsole.js";
export { createConsoleReporter } from "./report/console.js";
export { defineSuite, functionAdapter, toScorer, isPipelineFunction } from "./core/codeSuite.js";
export type { CodeSuite, InlineScorer, ScorerFn, PipelineFunction, PipelineFunctionResult } from "./core/codeSuite.js";
export { loadSuiteFile } from "./core/loadSuiteFile.js";
export type { LoadedSuite } from "./core/loadSuiteFile.js";
