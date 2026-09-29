/**
 * Static assets for the self-contained HTML report.
 *
 * Rules for this file:
 * - No backticks or `${` inside CSS/JS (they are template literals here).
 * - The report is written as UTF-8 and declares <meta charset="utf-8">, so the few
 *   symbols it uses (check, cross, arrows) are plain characters.
 * - Untrusted data (pipeline outputs) is only ever inserted with textContent,
 *   never innerHTML.
 */

export const EARLY_THEME_JS = String.raw`try{var t=(localStorage.getItem('behavtest-theme')||localStorage.getItem('regrade-theme'));if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export const CSS = String.raw`
:root {
  color-scheme: light;
  --page: #fafafa;
  --surface: #ffffff;
  --ink: #0f1115;
  --ink2: #475061;
  --muted: #6b7280;
  --grid: #e7e8ec;
  --border: #e7e8ec;
  --accent: #2563eb;
  --accent-ink: #ffffff;
  --wash: rgba(15, 17, 21, 0.04);
  --code: #f3f4f6;
  --good: #0ca30c;
  --warning: #fab219;
  --serious: #ec835a;
  --critical: #d03b3b;
  --neutral: #898781;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0b0d11;
    --surface: #12151b;
    --ink: #eceef2;
    --ink2: #b3b9c4;
    --muted: #8a919d;
    --grid: #232832;
    --border: #232832;
    --accent: #6ea8fe;
    --accent-ink: #0b0d11;
    --wash: rgba(255, 255, 255, 0.05);
    --code: #161a21;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0b0d11;
  --surface: #12151b;
  --ink: #eceef2;
  --ink2: #b3b9c4;
  --muted: #8a919d;
  --grid: #232832;
  --border: #232832;
  --accent: #6ea8fe;
  --accent-ink: #0b0d11;
  --wash: rgba(255, 255, 255, 0.05);
  --code: #161a21;
}
* { box-sizing: border-box; }
html { background: var(--page); }
body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1120px; margin: 0 auto; padding: 32px 20px 64px; }
h1, h2, h3, p, ul { margin: 0; }
.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
.brand { font-size: 12.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
h1 { font-size: 32px; line-height: 1.15; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; overflow-wrap: anywhere; }
.meta { color: var(--ink2); font-size: 14px; overflow-wrap: anywhere; }
.btn {
  font: inherit; font-size: 13px; color: var(--ink); background: var(--surface);
  border: 1px solid var(--border); border-radius: 10px; padding: 7px 12px; cursor: pointer; white-space: nowrap; font-weight: 500;
}
.btn:hover { background: var(--wash); border-color: var(--muted); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; margin-bottom: 28px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 20px; }
.tlabel { font-size: 13px; font-weight: 600; color: var(--ink2); }
.tvalue { font-size: 32px; line-height: 1.15; font-weight: 700; letter-spacing: -0.02em; margin: 8px 0 4px; font-variant-numeric: tabular-nums; }
.tsub { font-size: 13px; color: var(--ink2); }

.bar { display: flex; gap: 2px; height: 10px; margin: 12px 0 8px; }
.seg { display: block; min-width: 4px; }
.seg:first-child { border-radius: 4px 0 0 4px; }
.seg:last-child { border-radius: 0 4px 4px 0; }
.seg:only-child { border-radius: 4px; }
.legend { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--ink2); }
.legend li { display: inline-flex; align-items: center; gap: 6px; }
.legend b { color: var(--ink); font-weight: 600; }

.badge {
  --c: var(--neutral);
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; flex: none; border-radius: 50%;
  border: 2px solid var(--c);
  background: color-mix(in srgb, var(--c) 18%, transparent);
  color: var(--ink); font-size: 11px; font-weight: 700; line-height: 1;
}
.status { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }

section.block { margin-bottom: 32px; }
h2.sec { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 14px; }
.cmp-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.cmp-head h2 { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0 0 14px; font-size: 14px; }
dl.facts dt { color: var(--ink2); }
dl.facts dd { margin: 0; overflow-wrap: anywhere; }
.warn { color: var(--ink); background: color-mix(in srgb, var(--warning) 16%, transparent); border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent); border-radius: 10px; padding: 8px 12px; font-size: 13px; margin-bottom: 8px; }

.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
.scroll table { min-width: 680px; }
th { text-align: left; font-size: 12px; font-weight: 600; color: var(--ink2); padding: 8px 10px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
td { padding: 9px 10px; border-bottom: 1px solid var(--grid); vertical-align: top; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.id { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; overflow-wrap: anywhere; min-width: 200px; }
td .note { display: block; color: var(--ink2); font-size: 12px; margin-top: 2px; }
.dim { color: var(--ink2); }

.tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font: inherit; font-size: 13px; color: var(--ink); background: var(--surface);
  border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; cursor: pointer;
}
.chip:hover { border-color: var(--muted); }
.chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.search {
  font: inherit; font-size: 14px; color: var(--ink); background: var(--surface);
  border: 1px solid var(--border); border-radius: 10px; padding: 7px 12px; min-width: 220px; margin-left: auto;
}
.search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }
.cases { display: flex; flex-direction: column; gap: 8px; }
.cases { gap: 10px; }
details.case { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
details.case[open] { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
details.case > summary {
  list-style: none; cursor: pointer; padding: 12px 16px;
  display: grid; grid-template-columns: 110px 1fr auto auto; gap: 12px; align-items: center;
}
details.case > summary::-webkit-details-marker { display: none; }
details.case > summary::before { content: "\25B8"; position: absolute; margin-left: -12px; color: var(--muted); }
details.case[open] > summary::before { content: "\25BE"; }
details.case > summary:hover { background: var(--wash); border-radius: 12px; }
.cid { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; overflow-wrap: anywhere; }
.tags { display: inline-flex; gap: 4px; flex-wrap: wrap; margin-left: 8px; }
.tag { font-size: 11px; color: var(--ink2); border: 1px solid var(--border); border-radius: 999px; padding: 0 8px; }
.cnum { font-size: 13px; color: var(--ink2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cbody { padding: 4px 16px 16px; border-top: 1px solid var(--grid); }
.kv { margin-top: 12px; }
.kv > .k { font-size: 12px; font-weight: 600; color: var(--ink2); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
pre {
  margin: 0; padding: 12px 14px; background: var(--code); border: 1px solid var(--border); border-radius: 10px;
  font: 13px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  white-space: pre-wrap; overflow-wrap: anywhere; max-height: 280px; overflow: auto;
}
.attempt { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--grid); }
details.trace { margin-top: 12px; }
details.trace > summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--ink2); text-transform: uppercase; letter-spacing: 0.04em; }
.steps { margin-top: 8px; display: grid; gap: 2px; }
.srow > summary { list-style: none; cursor: pointer; }
.srow > summary::-webkit-details-marker { display: none; }
.srow[open] { padding-bottom: 8px; }
.step { display: grid; grid-template-columns: 72px minmax(0, 1fr) minmax(60px, 32%) 64px; gap: 10px; align-items: center; padding: 3px 4px; border-radius: 4px; font-size: 13px; }
.srow > summary:hover .step, .srow[open] .step { background: var(--wash); }
.step .kind { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.step .sname { overflow-wrap: anywhere; }
.step.serr .sname { color: var(--critical); }
.step .bar { position: relative; height: 8px; border-radius: 4px; background: var(--wash); }
.step .fill { position: absolute; top: 0; bottom: 0; min-width: 2px; border-radius: 4px; background: var(--accent); }
.step.serr .fill { background: var(--critical); }
.step .cnum { text-align: right; }
.ahead { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-bottom: 8px; }
.ahead .cnum { margin-left: 0; }
.err { margin: 6px 0; font-size: 14px; }
ul.scores { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
ul.scores li { display: flex; gap: 8px; align-items: flex-start; }
ul.scores .sn { font-weight: 600; min-width: 96px; }
ul.scores .sr { color: var(--ink2); overflow-wrap: anywhere; }
ul.scores .sm { color: var(--muted); font-size: 12px; margin-top: 2px; }
.empty { color: var(--ink2); padding: 16px; text-align: center; }
.lab { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.lab .lt { font-size: 12px; color: var(--muted); }
.lb { font: inherit; font-size: 12px; font-weight: 500; color: var(--ink2); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; cursor: pointer; }
.lb:hover { border-color: var(--muted); color: var(--ink); }
.lb[aria-pressed="true"][data-v="pass"] { background: color-mix(in srgb, var(--good) 16%, transparent); border-color: var(--good); color: var(--ink); }
.lb[aria-pressed="true"][data-v="fail"] { background: color-mix(in srgb, var(--critical) 14%, transparent); border-color: var(--critical); color: var(--ink); }
.labels { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 14px; margin-bottom: 12px; border: 1px dashed var(--border); border-radius: 12px; font-size: 13px; color: var(--ink2); }
.labels .lh { flex: 1 1 280px; }
.labels .lcount { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.btn[disabled] { opacity: .5; cursor: default; }
.ichart { position: relative; display: grid; gap: 2px; }
.irow { display: grid; grid-template-columns: minmax(120px, 28%) minmax(0, 1fr) 52px; gap: 14px; align-items: center; min-height: 40px; padding: 2px 6px; border-radius: 8px; }
.irow[tabindex]:hover, .irow[tabindex]:focus-visible { background: var(--wash); }
.ilabel { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
.iname { font-weight: 600; overflow-wrap: anywhere; }
.ipipe { width: 100%; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.itrack { position: relative; height: 28px; }
.igrid { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--grid); }
.iref { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--muted); }
.ispan { position: absolute; top: 12px; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--accent) 45%, transparent); }
.idot { position: absolute; top: 8px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--surface); }
.ival { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.iaxis { min-height: 18px; }
.iaxis .itrack { height: 16px; }
.itick { position: absolute; transform: translateX(-50%); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.itick:first-child { transform: none; }
.itick:last-child { transform: translateX(-100%); }
.ichart .tip { left: 28%; }
table.mgrid td.cell { text-align: right; white-space: nowrap; }
table.mgrid td.cell .status { gap: 6px; font-weight: 500; }
table.mgrid tr:not(.diff) td { color: var(--ink2); }
a.plain { color: inherit; text-decoration: none; }
a.plain:hover .cnum { text-decoration: underline; }
.tip {
  position: absolute; pointer-events: none; z-index: 2; min-width: 180px; max-width: 320px;
  background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12); padding: 8px 10px; font-size: 12.5px; line-height: 1.45;
}
.tip b { font-weight: 600; font-variant-numeric: tabular-nums; }
.tip .tm { color: var(--ink2); }
footer { color: var(--muted); font-size: 12.5px; margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--grid); }

@media (max-width: 640px) {
  .irow { grid-template-columns: minmax(84px, 34%) minmax(0, 1fr) 40px; gap: 8px; }
  .ichart .tip { left: 0; }
  .step { grid-template-columns: 60px minmax(0, 1fr) 56px; }
  .step .bar { display: none; }
  .wrap { padding: 20px 16px 48px; }
  h1 { font-size: 26px; }
  dl.facts { grid-template-columns: 1fr; gap: 0; }
  dl.facts dt { margin-top: 8px; font-size: 12px; }
  details.case > summary { grid-template-columns: 96px 1fr; }
  details.case > summary .cnum { grid-column: 2; }
  .search { margin-left: 0; width: 100%; }
}
@media print {
  .btn, .tools { display: none; }
  details.case > .cbody { display: block; }
}
`;

export { JS, REPORT_APP, UI_LIB } from "./ui.js";
