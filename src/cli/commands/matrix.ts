import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { renderMatrixHtml } from "../../matrix/html.js";
import { buildMatrix, loadMatrix, pickMatrix } from "../../matrix/matrix.js";
import { renderMatrixConsole, renderMatrixMarkdown } from "../../matrix/render.js";
import { fmtDate } from "../../report/format.js";
import { VERSION } from "../version.js";
import { colorFor, openExistingStore } from "./common.js";

export interface MatrixOptions {
  db?: string;
  suite?: string;
  reference?: string;
  list?: boolean;
  json?: string;
  md?: string;
  out?: string;
  color?: boolean;
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

/** Show a matrix (the latest, or one by id prefix), or list matrices. */
export function matrixCommand(ref: string | undefined, o: MatrixOptions): void {
  const store = openExistingStore(o.db);
  try {
    if (o.list) {
      const c = colorFor(o.color === false ? false : undefined);
      const all = store.listMatrices({ suiteName: o.suite, limit: 50 });
      if (all.length === 0) {
        process.stdout.write('No matrix runs yet. Add "variants" to a suite and run it.\n');
        return;
      }
      for (const m of all) {
        process.stdout.write(`${m.matrixId.slice(0, 8)}  ${fmtDate(m.startedAt)}  ${m.suiteName}  ${c.dim(m.variants.map((v) => v.variant).join(", "))}\n`);
      }
      return;
    }
    const matrix = pickMatrix(store, ref, o.suite);
    const report = buildMatrix(matrix.matrixId, loadMatrix(store, matrix), o.reference);
    process.stdout.write(renderMatrixConsole(report, { color: o.color === false ? false : undefined }));
    if (o.json) {
      write(o.json, `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`  json → ${o.json}\n`);
    }
    if (o.md) {
      write(o.md, renderMatrixMarkdown(report));
      process.stdout.write(`  markdown → ${o.md}\n`);
    }
    if (o.out) {
      write(o.out, renderMatrixHtml(report, VERSION));
      process.stdout.write(`  report → ${o.out} (${Math.round(statSync(o.out).size / 1024)} KB, single self-contained file)\n`);
    }
  } finally {
    store.close();
  }
}
