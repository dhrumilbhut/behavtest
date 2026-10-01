#!/usr/bin/env node
// Builds the documentation website from README.md, so the site and the README can never disagree:
// a landing page, one page per how-to guide and per reference section, the FAQ with FAQPage
// structured data, sitemap.xml, robots.txt, llms.txt and llms-full.txt (llmstxt.org).
// Pages that are not reference material (learning guides, integrations, comparisons, blog posts) are
// Markdown files in pages/, each starting with a front-matter block; they use the same renderer and
// layout. Blog posts (pages/blog/<slug>.md) also need a date, topics and their own social card in
// site-static/og/blog/<slug>.png (made by scripts/og-image.mts). Images in pages are written as a
// line of their own, ![caption](/blog/<slug>/<file>.png), and live in site-static/blog/<slug>/.
// The sample report is written separately into <out>/sample by scripts/sample-report.mjs.
//
//   node scripts/site.mts [--out site]
//
// No dependencies: README.md uses a small subset of Markdown, rendered here.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://dhrumilbhut.github.io/behavtest";
const REPO = "https://github.com/dhrumilbhut/behavtest";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1]! : join(root, "site");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; author: string };

// ---- Markdown subset ------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GitHub's heading anchor: lower case, drop punctuation except - and _, spaces to hyphens. */
export const slugify = (heading: string) =>
  heading.replace(/`/g, "").trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");

type LinkMapper = (href: string) => string;
/** Resolves an image path written in Markdown to the URL to use and, for PNGs, its size. */
type ImageMapper = (src: string) => { src: string; width?: number; height?: number };

const noImages: ImageMapper = (src) => {
  throw new Error(`image ${src}: images are only supported in pages/ (README sections can't hold them)`);
};

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  if (b.length < 24 || b.toString("ascii", 1, 4) !== "PNG") throw new Error(`${file} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function emphasis(text: string): string {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?=[^\w*]|$)/g, "$1<em>$2</em>");
}

function inline(text: string, link: LinkMapper): string {
  let out = "";
  let last = 0;
  // bold may wrap code (**`.mts`**), link text may contain code: match those as whole tokens
  const re = /\*\*((?:`[^`]*`|[^*])+?)\*\*|`([^`]+)`|\[((?:`[^`]*`|[^\]])+)\]\(([^)\s]+)\)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out += emphasis(text.slice(last, m.index));
    if (m[1] !== undefined) out += `<strong>${inline(m[1], link)}</strong>`;
    else if (m[2] !== undefined) out += `<code>${esc(m[2])}</code>`;
    else out += `<a href="${esc(link(m[4]!))}">${inline(m[3]!, link)}</a>`;
    last = re.lastIndex;
  }
  return out + emphasis(text.slice(last));
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** Render Markdown to HTML. Headings get GitHub-style ids; `link` rewrites every href. */
export function renderMarkdown(md: string, link: LinkMapper, image: ImageMapper = noImages): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join(" "), link)}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      html.push(`<pre><code${fence[1] ? ` class="language-${fence[1]}"` : ""}>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const figure = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (figure) {
      flush();
      const alt = figure[1]!.trim();
      if (!alt) throw new Error(`image ${figure[2]}: write a caption between the brackets (it is the alt text)`);
      const img = image(figure[2]!);
      const size = img.width ? ` width="${img.width}" height="${img.height}"` : "";
      html.push(`<figure><img src="${esc(img.src)}" alt="${esc(alt)}"${size} loading="lazy" decoding="async"><figcaption>${inline(alt, link)}</figcaption></figure>`);
      continue;
    }
    const heading = /^(#{1,6}) (.+)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      html.push(`<h${level} id="${slugify(heading[2]!)}">${inline(heading[2]!, link)}</h${level}>`);
      continue;
    }
    if (line.startsWith("|") && /^\|[\s|:-]+\|$/.test(lines[i + 1]?.trim() ?? "")) {
      flush();
      const head = cells(line);
      const body: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.startsWith("|"); i++) body.push(cells(lines[i]!));
      i--;
      const th = head.every((h) => h === "") ? "" : `<thead><tr>${head.map((h) => `<th>${inline(h, link)}</th>`).join("")}</tr></thead>`;
      html.push(`<div class="table"><table>${th}<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c, link)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const item = /^(\s*)(-|\d+\.) (.+)$/.exec(line);
    if (item) {
      flush();
      const ordered = item[2] !== "-";
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = /^(\s*)(-|\d+\.) (.+)$/.exec(lines[i]!);
        if (!m) break;
        items.push(`<li>${inline(m[3]!, link)}</li>`);
      }
      i--;
      html.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (line.trim() === "") flush();
    else para.push(line.trim());
  }
  flush();
  return html.join("\n");
}

/** Plain text of a Markdown snippet, for meta descriptions. */
const plain = (md: string) =>
  md.replace(/```[\s\S]*?```/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*]/g, "").replace(/\s+/g, " ").trim();

function describe(md: string, title: string): string {
  // the opening prose, list items included ("Use BehavTest when: - ..."), until there is a snippet's worth
  let first = "";
  for (const block of md.replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/)) {
    const p = block.trim();
    if (!p || /^(#|\|)/.test(p)) {
      if (first) break;
      continue;
    }
    first += ` ${p.replace(/^(- |\d+\. )/gm, "")}`;
    if (plain(first).length >= 100) break;
  }
  // a page that opens with a table or code has no prose to quote
  const text = plain(first) || `${title}: reference for BehavTest, the open-source behavioral regression testing tool for AI applications.`;
  return text.length <= 158 ? text : `${text.slice(0, 155).replace(/\s+\S*$/, "")}…`;
}

// ---- Split the README into pages ----------------------------------------------------------------

type Kind = "home" | "guide" | "doc" | "learn" | "integration" | "comparison" | "blog";

interface Page {
  path: string; // "" for the landing page, else e.g. "docs/x/", "guides/x/", "llm-testing/", "integrations/x/"
  title: string;
  heading: string;
  body: string; // Markdown, starting with the page's own heading
  kind: Kind;
  description?: string; // pages/ only: the meta description (README pages derive theirs from the text)
  label?: string; // pages/ only: a short name for link tiles and the pager (default: the title)
  order?: number; // pages/ only: position within its kind
  date?: string; // blog posts only: publication date, YYYY-MM-DD
  topics?: string[]; // blog posts only: `topics: a, b` or `topics: [a, b]`
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-09-30" -> "30 September 2026" (no locale dependence). */
const longDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** A real calendar date written as YYYY-MM-DD. */
const isIsoDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Pages from pages/*.md (recursively). Each starts with a front-matter block of `key: value` lines. */
export function loadContentPages(dir: string): Page[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  (function walk(d: string) {
    for (const name of readdirSync(d)) {
      const f = join(d, name);
      if (statSync(f).isDirectory()) walk(f);
      else if (name.endsWith(".md")) files.push(f);
    }
  })(dir);
  const kinds = new Set<Kind>(["learn", "integration", "comparison", "doc", "blog"]);
  return files.map((file) => {
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!m) throw new Error(`${file}: missing the front-matter block (---)`);
    const meta = Object.fromEntries(m[1]!.split("\n").map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter((x) => x).map((x) => [x![1], x![2]!.trim()]));
    const body = text.slice(m[0].length).trim() + "\n";
    const prose = body.replace(/^```[\s\S]*?^```/gm, ""); // "# " inside code blocks is not a heading
    const heading = /^# (.+)$/m.exec(prose)?.[1]?.trim();
    for (const key of ["path", "title", "description", "kind"]) if (!meta[key]) throw new Error(`${file}: front matter needs "${key}"`);
    if (!heading) throw new Error(`${file}: the page needs one "# " heading`);
    if ((prose.match(/^# /gm) ?? []).length !== 1) throw new Error(`${file}: exactly one "# " heading per page`);
    if (!kinds.has(meta.kind as Kind)) throw new Error(`${file}: kind must be learn, integration, comparison, doc or blog`);
    if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*\/$/.test(meta.path!)) throw new Error(`${file}: path must look like "x/" or "x/y/"`);
    if (meta.description!.length > 160) throw new Error(`${file}: description is ${meta.description!.length} characters (max 160)`);
    const page: Page = { path: meta.path!, title: meta.title!, heading, body, kind: meta.kind as Kind, description: meta.description, label: meta.label || undefined, order: Number(meta.order ?? 100) };
    if (page.kind === "blog") {
      const slug = basename(file, ".md");
      if (page.path !== `blog/${slug}/`) throw new Error(`${file}: a blog post's path must be "blog/${slug}/" (its file name)`);
      if (!meta.date || !isIsoDate(meta.date)) throw new Error(`${file}: a blog post needs "date: YYYY-MM-DD" (a real date)`);
      const topics = (meta.topics ?? "").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean);
      if (topics.length === 0) throw new Error(`${file}: a blog post needs "topics: a, b" (at least one)`);
      page.date = meta.date;
      page.topics = topics;
    }
    return page;
  }).sort((a, b) =>
    a.kind !== b.kind ? 0
    : a.kind === "blog" ? b.date!.localeCompare(a.date!) || a.path.localeCompare(b.path) // newest first
    : a.order! - b.order! || a.path.localeCompare(b.path));
}

/** "../" once per path segment: the way back to the site root from a page. */
const upFrom = (page: Page) => "../".repeat(page.path.split("/").filter(Boolean).length);

/** Short URLs for the reference sections (the README's H2 headings). */
const DOC_SLUGS: Record<string, string> = {
  "Why AI applications need behavioral regression tests": "why-behavioral-regression-tests",
  "How it works": "how-it-works",
  Installation: "installation",
  "When to use BehavTest": "when-to-use",
  Quickstart: "quickstart",
  Concepts: "concepts",
  Configuration: "configuration",
  "Suite format": "suite-format",
  "Adapters: what to test": "adapters",
  Scorers: "scorers",
  "Code suites: TypeScript or JavaScript": "code-suites",
  "Traces: check what the agent did, not just what it said": "traces",
  "RAG: test retrieval and grounded answers": "rag",
  "Judge calibration: does the judge agree with you?": "calibration",
  "Non-determinism: repeat your cases": "repeats",
  "Compare runs: what regressed, and is it real?": "compare",
  "Matrix runs: compare models and prompts side by side": "matrix",
  "GitHub Action": "github-action",
  "Baselines and CI: fail the pull request that made things worse": "ci-baselines",
  Reports: "reports",
  "Dashboard: browse, compare and label runs": "dashboard",
  "Exit codes and storage": "exit-codes-and-storage",
  Cost: "cost",
  "CLI reference": "cli",
  "Library API and custom scorers": "library",
  FAQ: "faq",
  "For AI coding assistants": "for-ai-assistants",
  "Security and privacy": "security",
  "Prior art": "prior-art",
  Troubleshooting: "troubleshooting",
  "Migrating from Regrade": "migrating-from-regrade",
  Roadmap: "roadmap",
};
const SKIP = new Set(["Contents", "Development", "Contributing", "License", "How-to guides", "Integrations", "Learn more"]);

export function splitReadme(readme: string): Page[] {
  const noBadges = readme.replace(/^\[!\[.*$/m, "");
  const parts = noBadges.split(/^(?=## )/m);
  const intro = parts.shift()!;
  const pages: Page[] = [
    { path: "", title: "BehavTest: behavioral regression testing for AI applications", heading: "BehavTest", body: intro, kind: "home" },
  ];
  for (const part of parts) {
    const heading = /^## (.+)$/m.exec(part)![1]!.trim();
    if (heading === "How-to guides") {
      for (const guide of part.split(/^(?=### )/m).slice(1)) {
        const h = /^### (.+)$/m.exec(guide)![1]!.trim();
        pages.push({ path: `guides/${slugify(h)}/`, title: h.replace(/`/g, ""), heading: h, body: guide.replace(/^### /m, "# "), kind: "guide" });
      }
      continue;
    }
    if (SKIP.has(heading)) continue;
    const slug = DOC_SLUGS[heading];
    if (!slug) throw new Error(`README section "${heading}" has no page slug in scripts/site.mts (add it to DOC_SLUGS or SKIP)`);
    // The page's own heading becomes <h1>; its sub-sections move up one level.
    const body = part.replace(/^## /m, "# ").replace(/^### /gm, "## ").replace(/^#### /gm, "### ");
    pages.push({ path: `docs/${slug}/`, title: heading.replace(/`/g, ""), heading, body, kind: "doc" });
  }
  return pages;
}

// ---- Links --------------------------------------------------------------------------------------

/** Every heading anchor in the README -> the page that now holds it. */
function anchorIndex(pages: Page[]): Map<string, Page> {
  const index = new Map<string, Page>();
  for (const p of pages) {
    for (const m of p.body.matchAll(/^#{1,6} (.+)$/gm)) {
      const slug = slugify(m[1]!);
      if (!index.has(slug)) index.set(slug, p);
    }
  }
  // the README's own section headings (before they moved up a level) keep resolving
  for (const p of pages) if (p.kind !== "home") index.set(slugify(p.heading), p);
  return index;
}

function linker(page: Page, anchors: Map<string, Page>, paths: Set<string>): LinkMapper {
  const up = upFrom(page);
  return (href) => {
    if (href.startsWith("/")) {
      // a link to another site page, written from the site root: "/llm-testing/" or "/docs/compare/#anchor"
      const [path, anchor] = href.slice(1).split("#") as [string, string | undefined];
      if (!paths.has(path)) throw new Error(`link ${href} on ${page.path || "the landing page"} points at no page`);
      const url = path === page.path ? "" : up + path || "./";
      return anchor ? `${url}#${anchor}` : url || "#";
    }
    if (/^https?:|^mailto:/.test(href)) {
      if (href === `${SITE}/` || href === SITE) return up || "./";
      if (href.startsWith(`${SITE}/`)) return up + href.slice(SITE.length + 1);
      return href;
    }
    if (href.startsWith("#")) {
      const target = anchors.get(href.slice(1));
      if (!target) throw new Error(`README link ${href} points at no heading`);
      const isPageTop = target.kind !== "home" && slugify(target.heading) === href.slice(1);
      const url = target === page ? "" : up + target.path || "./";
      return isPageTop ? url || "#" : `${url}${href}`;
    }
    return `${REPO}/blob/main/${href}`; // LICENSE, CHANGELOG.md, SECURITY.md
  };
}

// ---- HTML ---------------------------------------------------------------------------------------

// Light by default; dark from the system setting, or from the toggle (stored per browser).
const CSS = `
:root {
  color-scheme: light;
  --bg: #fafafa; --surface: #ffffff; --raised: #ffffff; --ink: #0f1115; --ink2: #475061; --muted: #6b7280;
  --line: #e7e8ec; --line2: #d9dbe1; --accent: #2563eb; --accent-ink: #ffffff; --accent-soft: rgba(37, 99, 235, .08);
  --code-bg: #f3f4f6; --shadow: 0 1px 2px rgba(15, 17, 21, .04), 0 8px 24px rgba(15, 17, 21, .06);
  --header: rgba(250, 250, 250, .82);
  --term-bg: #0e1116; --term-ink: #e6e9ef; --term-dim: #8b93a1; --good: #4ade80; --bad: #f87171; --warn: #fbbf24;
  --wide: 1120px; --text: 760px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #0b0d11; --surface: #12151b; --raised: #161a21; --ink: #eceef2; --ink2: #b3b9c4; --muted: #8a919d;
    --line: #232832; --line2: #2e3440; --accent: #6ea8fe; --accent-ink: #0b0d11; --accent-soft: rgba(110, 168, 254, .12);
    --code-bg: #161a21; --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 8px 24px rgba(0, 0, 0, .35); --header: rgba(11, 13, 17, .78);
    --term-bg: #0e1116;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0b0d11; --surface: #12151b; --raised: #161a21; --ink: #eceef2; --ink2: #b3b9c4; --muted: #8a919d;
  --line: #232832; --line2: #2e3440; --accent: #6ea8fe; --accent-ink: #0b0d11; --accent-soft: rgba(110, 168, 254, .12);
  --code-bg: #161a21; --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 8px 24px rgba(0, 0, 0, .35); --header: rgba(11, 13, 17, .78);
  --term-bg: #0e1116;
}
* { box-sizing: border-box; }
html { background: var(--bg); -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-underline-offset: 3px; text-decoration-thickness: 1px; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
svg.i { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.wrap { max-width: var(--wide); margin: 0 auto; padding: 0 20px; }

/* header */
.top { position: sticky; top: 0; z-index: 10; background: var(--header); backdrop-filter: saturate(180%) blur(12px); -webkit-backdrop-filter: saturate(180%) blur(12px); border-bottom: 1px solid var(--line); }
.top .wrap { display: flex; align-items: center; gap: 20px; height: 60px; }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; font-weight: 700; font-size: 17px; letter-spacing: -.01em; }
.brand svg { width: 26px; height: 26px; }
.menu { display: flex; gap: 4px; margin-left: auto; align-items: center; }
.menu a { color: var(--ink2); text-decoration: none; font-size: 14.5px; padding: 6px 10px; border-radius: 8px; }
.menu a:hover { color: var(--ink); background: var(--accent-soft); }
.theme { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--line2); background: var(--surface); color: var(--ink2); cursor: pointer; }
.theme:hover { color: var(--ink); border-color: var(--muted); }
.theme .i-sun { display: none; }
:root[data-theme="dark"] .theme .i-sun { display: block; }
:root[data-theme="dark"] .theme .i-moon { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .theme .i-sun { display: block; }
  :root:not([data-theme="light"]) .theme .i-moon { display: none; }
}
@media (max-width: 760px) { .menu .opt { display: none; } .top .wrap { gap: 10px; } .menu a { padding: 6px 7px; font-size: 14px; } }

/* buttons, chips */
.btn { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px; border-radius: 10px; font-weight: 600; font-size: 15px; text-decoration: none; border: 1px solid transparent; }
.btn:hover { text-decoration: none; }
.btn.primary { background: var(--accent); color: var(--accent-ink); }
.btn.primary:hover { filter: brightness(1.08); }
.btn.ghost { border-color: var(--line2); color: var(--ink); background: var(--surface); }
.btn.ghost:hover { border-color: var(--muted); }
.pill { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--line2); background: var(--surface); color: var(--ink2); font-size: 13px; font-weight: 500; }
.pill b { color: var(--accent); font-weight: 600; }

/* landing */
.hero { padding: 72px 0 56px; }
.hero .wrap { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 56px; align-items: center; }
.hero h1 { font-size: clamp(34px, 5vw, 52px); line-height: 1.08; letter-spacing: -.03em; margin: 18px 0 18px; font-weight: 750; }
.hero h1 span { color: var(--accent); }
.lede { font-size: 18.5px; line-height: 1.6; color: var(--ink2); margin: 0 0 28px; max-width: 34em; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 22px; }
.install { display: flex; align-items: center; gap: 10px; max-width: 100%; padding: 6px 6px 6px 16px; border: 1px solid var(--line2); border-radius: 12px; background: var(--surface); font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.install code { background: none; padding: 0; font-size: 13px; flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; color: var(--ink); }
.install code::before { content: "$ "; color: var(--muted); }
.note { color: var(--muted); font-size: 13.5px; margin: 10px 0 0; }
.term { margin: 0; background: var(--term-bg); color: var(--term-ink); border-radius: 16px; border: 1px solid #1f2530; box-shadow: var(--shadow); overflow: hidden; font: 12.8px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.term .bar { display: flex; align-items: center; gap: 7px; padding: 12px 14px; border-bottom: 1px solid #1f2530; color: var(--term-dim); font-size: 12px; }
.term .bar i { width: 11px; height: 11px; border-radius: 50%; background: #2b3240; display: inline-block; }
.term .bar span { margin-left: 8px; }
.term pre { margin: 0; padding: 16px 18px 18px; background: none; border: 0; border-radius: 0; overflow-x: auto; color: var(--term-ink); font: inherit; }
.term .d { color: var(--term-dim); } .term .g { color: var(--good); } .term .r { color: var(--bad); } .term .y { color: var(--warn); } .term .b { font-weight: 700; }
.band { padding: 20px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--surface); }
.band .wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; }
.band .label { color: var(--muted); font-size: 13.5px; margin-right: 6px; }
.chip { padding: 5px 12px; border-radius: 999px; background: var(--accent-soft); color: var(--ink); font-size: 13.5px; }
section.block { padding: 80px 0 0; }
.eyebrow { color: var(--accent); font-weight: 600; font-size: 13.5px; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 10px; }
section.block h2 { font-size: clamp(26px, 3.2vw, 34px); line-height: 1.2; letter-spacing: -.02em; margin: 0 0 12px; border: 0; padding: 0; }
.sub { color: var(--ink2); font-size: 17px; margin: 0 0 32px; max-width: 42em; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.feature { padding: 22px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
.feature .ico { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); margin-bottom: 14px; }
.feature h3 { margin: 0 0 6px; font-size: 17px; letter-spacing: -.01em; }
.feature p { margin: 0; color: var(--ink2); font-size: 15px; line-height: 1.6; }
.steps { counter-reset: step; }
.step { position: relative; padding: 22px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
.step::before { counter-increment: step; content: counter(step); display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); font-weight: 700; font-size: 14px; margin-bottom: 12px; }
.step h3 { margin: 0 0 6px; font-size: 17px; }
.step p { margin: 0 0 14px; color: var(--ink2); font-size: 15px; }
.step pre { margin: 0; font-size: 12.5px; }
.links { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; padding: 0; margin: 0; }
.links a { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 100%; padding: 16px 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); text-decoration: none; font-weight: 500; font-size: 15.5px; line-height: 1.4; }
.links a::after { content: "→"; color: var(--muted); transition: transform .15s; }
.links a:hover { border-color: var(--accent); }
.links a:hover::after { color: var(--accent); transform: translateX(3px); }
.links small { color: var(--muted); font-weight: 400; font-size: 13px; white-space: nowrap; margin-left: auto; }
/* blog: these must out-rank the generic .doc p / .doc h2 rules further down */
.doc .byline { color: var(--muted); font-size: 14px; margin: -8px 0 28px; }
.doc .post { padding: 22px 0; border-top: 1px solid var(--line); }
.doc .post h2 { margin: 0 0 6px; padding: 0; border: 0; font-size: 21px; }
.doc .post h2 a { color: var(--ink); text-decoration: none; }
.doc .post h2 a:hover { color: var(--accent); }
.doc .post .byline { margin: 0 0 8px; }
.doc .post p { margin: 0; }
.doc figure { margin: 28px 0; }
.doc figure img { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 12px; }
.doc figcaption { color: var(--muted); font-size: 13.5px; line-height: 1.5; margin-top: 10px; }
.ref { columns: 3 220px; column-gap: 32px; list-style: none; padding: 0; margin: 0; }
.ref li { break-inside: avoid; padding: 6px 0; border-bottom: 1px solid var(--line); }
.ref a { color: var(--ink); text-decoration: none; font-size: 15px; }
.ref a:hover { color: var(--accent); }
.final { margin: 96px 0 0; padding: 48px 20px; text-align: center; border-top: 1px solid var(--line); background: var(--surface); }
.final h2 { font-size: clamp(24px, 3vw, 30px); letter-spacing: -.02em; margin: 0 0 10px; }
.final p { color: var(--ink2); margin: 0 0 24px; }
.final .install { margin: 0 auto; max-width: 560px; text-align: left; }
@media (max-width: 600px) {
  .install code { white-space: normal; overflow-wrap: anywhere; }
  .term { font-size: 11px; }
  .term pre { padding: 14px; }
}
@media (max-width: 900px) {
  .hero { padding: 44px 0 40px; }
  .hero .wrap { grid-template-columns: minmax(0, 1fr); gap: 36px; }
  .grid, .links { grid-template-columns: minmax(0, 1fr); }
  section.block { padding-top: 56px; }
}
@media (min-width: 640px) and (max-width: 900px) { .grid, .links { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* documentation pages */
.doc { max-width: var(--text); margin: 0 auto; padding: 36px 20px 64px; }
.crumbs { font-size: 13.5px; color: var(--muted); margin: 0 0 8px; }
.crumbs a { color: var(--muted); text-decoration: none; }
.crumbs a:hover { color: var(--accent); }
.doc h1 { font-size: clamp(28px, 4vw, 38px); line-height: 1.15; letter-spacing: -.025em; margin: 0 0 20px; }
.doc h2 { font-size: 23px; letter-spacing: -.015em; margin: 44px 0 12px; padding-top: 20px; border-top: 1px solid var(--line); }
.doc h3 { font-size: 18px; margin: 32px 0 8px; }
.doc p, .doc li { color: var(--ink); }
.doc li { margin: 4px 0; }
.doc h1 + p { font-size: 18px; color: var(--ink2); }
code { font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code-bg); padding: 2px 6px; border-radius: 6px; }
pre { position: relative; font-size: 13px; line-height: 1.55; background: var(--code-bg); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 13px; }
.copy { position: absolute; top: 8px; right: 8px; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--line2); background: var(--surface); color: var(--ink2); font: 500 12px/1.4 ui-sans-serif, system-ui, sans-serif; cursor: pointer; opacity: 0; transition: opacity .15s; }
pre:hover .copy, .copy:focus-visible, .install .copy { opacity: 1; }
.install .copy { position: static; flex: none; height: 32px; }
@media (hover: none) { .copy { opacity: 1; } }
.table { overflow-x: auto; margin: 20px 0; border: 1px solid var(--line); border-radius: 12px; }
table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
th, td { text-align: left; vertical-align: top; padding: 10px 14px; border-bottom: 1px solid var(--line); }
tr:last-child td { border-bottom: 0; }
th { color: var(--ink2); font-weight: 600; background: var(--code-bg); }
.pager { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 56px; }
.pager a { display: block; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); text-decoration: none; font-size: 15px; }
.pager a small { display: block; color: var(--muted); font-size: 12.5px; margin-bottom: 2px; }
.pager a:hover { border-color: var(--accent); }
.pager a.next { text-align: right; grid-column: 2; }

/* footer */
.foot { margin-top: 0; border-top: 1px solid var(--line); }
.foot .wrap { display: flex; flex-wrap: wrap; gap: 8px 22px; align-items: center; padding-top: 22px; padding-bottom: 28px; color: var(--muted); font-size: 13.5px; }
.foot a { color: var(--muted); text-decoration: none; }
.foot a:hover { color: var(--ink); }
.foot .sp { margin-right: auto; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

const THEME_EARLY = `try{var t=localStorage.getItem("behavtest-theme")||localStorage.getItem("regrade-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

const THEME_AND_COPY = `(function(){
var b=document.getElementById("theme");
function cur(){var a=document.documentElement.getAttribute("data-theme");return a||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}
function sync(){if(!b)return;var d=cur()==="dark";b.setAttribute("aria-label",d?"Switch to light theme":"Switch to dark theme");b.title=b.getAttribute("aria-label")}
if(b){b.addEventListener("click",function(){var n=cur()==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",n);try{localStorage.setItem("behavtest-theme",n)}catch(e){}sync()});sync()}
function copyButton(host,text){var c=document.createElement("button");c.type="button";c.className="copy";c.textContent="Copy";c.addEventListener("click",function(){if(!navigator.clipboard)return;navigator.clipboard.writeText(text()).then(function(){c.textContent="Copied";setTimeout(function(){c.textContent="Copy"},1400)},function(){})});host.appendChild(c)}
document.querySelectorAll("pre:not(.plain)").forEach(function(p){copyButton(p,function(){var c=p.querySelector("code");return (c||p).textContent})});
document.querySelectorAll(".install").forEach(function(el){copyButton(el,function(){return el.querySelector("code").textContent})});
})();`;

const ICONS: Record<string, string> = {
  logo: `<svg viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="7" fill="var(--accent)"/><path d="M6 9.5l4.5 5 3-3 6.5 6.5" fill="none" stroke="var(--accent-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 18h4.5v-4.5" fill="none" stroke="var(--accent-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  sun: `<svg class="i i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>`,
  moon: `<svg class="i i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`,
  run: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/></svg>`,
  check: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12.5 2.5 2.5 5-6"/></svg>`,
  stats: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/></svg>`,
  pr: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M6 8.2v7.6M18 15.8V10a3 3 0 0 0-3-3h-3"/><path d="m13.5 5-1.8 2 1.8 2"/></svg>`,
  trace: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v6h5M10 11v6h5"/><circle cx="5" cy="5" r="1.6"/><circle cx="10" cy="11" r="1.6"/><circle cx="15" cy="17" r="1.6"/><path d="M13 5h6M15 11h4M18 17h1"/></svg>`,
  local: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="m9.5 12 2 2 3.5-4"/></svg>`,
};

function jsonLd(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`;
}

function faqLd(md: string) {
  const entities = [...md.matchAll(/^\*\*(.+?\?)\*\*\n([\s\S]+?)(?=\n\n|$)/gm)].map((m) => ({
    "@type": "Question",
    name: m[1],
    acceptedAnswer: { "@type": "Answer", text: plain(m[2]!) },
  }));
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: entities };
}

/** The site icon, written to favicon.svg. */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26"><rect width="26" height="26" rx="7" fill="#2563eb"/><path d="M6 9.5l4.5 5 3-3 6.5 6.5M15.5 18h4.5v-4.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;

/** Social preview card (1200x630), copied from site-static/ by the CLI below. */
const OG_IMAGE = `${SITE}/og-image.png`;

function layout(page: Page, content: string, extraHead: string, opts: { notFound?: boolean; image?: string; imageAlt?: string; blog?: boolean } = {}): string {
  // the 404 page is served at any depth: its links start from <base>, the site root
  const up = opts.notFound ? "./" : upFrom(page);
  const home = up || "./";
  const url = `${SITE}/${page.path}`;
  const description = page.kind === "home"
    ? "Behavioral regression testing for AI applications: run LLM app, agent and RAG test cases repeatedly, compare runs statistically, fail CI on real regressions."
    : page.description ?? describe(page.body.replace(/^# .*$/m, ""), page.title);
  // "X | BehavTest", unless the title already names BehavTest ("BehavTest vs Promptfoo")
  const title = page.kind === "home" || page.title.includes("BehavTest") ? page.title : `${page.title} | BehavTest`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${opts.notFound ? `<meta name="robots" content="noindex">\n<base href="${SITE}/">` : `<link rel="canonical" href="${url}">`}
<meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b0d11" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="${page.kind === "home" ? "website" : "article"}">
<meta property="og:site_name" content="BehavTest">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${opts.notFound ? "" : `<meta property="og:url" content="${url}">\n`}<meta property="og:image" content="${opts.image ?? OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(opts.imageAlt ?? "BehavTest: behavioral regression testing for AI applications")}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${opts.image ?? OG_IMAGE}">
<link rel="icon" type="image/svg+xml" href="${up}favicon.svg">
<link rel="alternate" type="text/plain" title="llms.txt" href="${up}llms.txt">${opts.blog ? `\n<link rel="alternate" type="application/rss+xml" title="BehavTest blog" href="${up}blog/feed.xml">` : ""}
<script>${THEME_EARLY}</script>
${extraHead}
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="wrap">
<a class="brand" href="${home}">${ICONS.logo}BehavTest</a>
<nav class="menu" aria-label="Site">
<a href="${up}docs/quickstart/">Quickstart</a>
<a class="opt" href="${up}#learn">Learn</a>
<a class="opt" href="${up}#how-to-guides">Guides</a>${opts.blog ? `\n<a class="opt" href="${up}blog/">Blog</a>` : ""}
<a class="opt" href="${up}#reference">Reference</a>
<a class="opt" href="${up}docs/faq/">FAQ</a>
<a class="opt" href="${up}sample/">Sample report</a>
<a href="${REPO}">GitHub</a>
</nav>
<button class="theme" id="theme" type="button" aria-label="Switch theme">${ICONS.moon}${ICONS.sun}</button>
</div></header>
${content}
<footer class="foot"><div class="wrap">
<span class="sp">BehavTest ${esc(pkg.version)} · MIT license · formerly Regrade</span>
<a href="${up}#learn">Learn</a>
<a href="${up}integrations/">Integrations</a>
<a href="${up}comparisons/">Comparisons</a>${opts.blog ? `\n<a href="${up}blog/">Blog</a>` : ""}
<a href="${REPO}">GitHub</a>
<a href="https://www.npmjs.com/package/behavtest">npm</a>
<a href="${REPO}/blob/main/CHANGELOG.md">Changelog</a>
<a href="${up}llms.txt">llms.txt</a>
<a href="${REPO}#readme">Generated from the README</a>
</div></footer>
<script>${THEME_AND_COPY}</script>
</body>
</html>
`;
}

/** Where a page sits, for the breadcrumb trail and BreadcrumbList data: [label, path from the site root][]. */
function trail(page: Page): [string, string][] {
  const section: Record<Exclude<Kind, "home">, [string, string]> = {
    guide: ["How-to guides", "#how-to-guides"],
    doc: ["Reference", "#reference"],
    learn: ["Learn", "#learn"],
    integration: ["Integrations", "integrations/"],
    comparison: ["Comparisons", "comparisons/"],
    blog: ["Blog", "blog/"],
  };
  if (page.kind === "home") return [];
  const s = section[page.kind];
  return page.path === s[1] ? [["BehavTest", ""]] : [["BehavTest", ""], s];
}

function docPage(page: Page, body: string, pager: string): string {
  const up = upFrom(page);
  if (page.kind === "blog") {
    const byline = `<p class="byline"><time datetime="${page.date}">${longDate(page.date!)}</time> · ${esc(pkg.author)} · ${page.topics!.map(esc).join(", ")}</p>`;
    body = body.replace("</h1>", `</h1>\n${byline}`);
  }
  const crumbs = `<p class="crumbs">${trail(page).map(([label, path]) => `<a href="${up}${path}">${esc(label)}</a>`).join(" › ")}</p>`;
  return `<main class="doc">\n${crumbs}\n${body}\n${pager}\n</main>`;
}

const install = (cmd: string) => `<div class="install"><code>${esc(cmd)}</code></div>`;

function landing(pages: Page[]): string {
  const guides = pages.filter((p) => p.kind === "guide");
  const docs = pages.filter((p) => p.kind === "doc");
  const learn = pages.filter((p) => p.kind === "learn");
  const integrations = pages.filter((p) => p.kind === "integration" && p.path !== "integrations/");
  const comparisons = pages.filter((p) => p.kind === "comparison" && p.path !== "comparisons/");
  const posts = pages.filter((p) => p.kind === "blog"); // already newest first
  const LATEST = 3; // the landing page shows the newest few; /blog/ lists them all
  const linkList = (list: Page[]) =>
    `<ul class="links">${list.map((p) => `<li><a href="${p.path}">${esc(p.label ?? p.title)}${p.date ? ` <small><time datetime="${p.date}">${longDate(p.date)}</time></small>` : ""}</a></li>`).join("")}</ul>`;
  const section = (id: string, eyebrow: string, h2: string, sub: string, list: Page[], more = "") =>
    list.length ? `<section class="block" id="${id}"><div class="wrap">\n<p class="eyebrow">${eyebrow}</p>\n<h2>${h2}</h2>\n<p class="sub">${sub}</p>\n${linkList(list)}${more}\n</div></section>\n\n` : "";
  const feature = (icon: string, title: string, text: string, href: string) =>
    `<article class="feature"><span class="ico">${ICONS[icon]}</span><h3><a href="${href}" style="color:inherit;text-decoration:none">${title}</a></h3><p>${text}</p></article>`;
  return `<main>
<section class="hero"><div class="wrap">
<div>
<span class="pill"><b>v${esc(pkg.version)}</b> Open source · MIT · No account</span>
<h1>Behavioral regression testing for <span>AI applications</span></h1>
<p class="lede">AI output is nondeterministic, so one run proves little. BehavTest runs your LLM app, agent or RAG test cases repeatedly, scores every answer, and uses statistics to tell a real change in behavior from random noise, then fails the pull request that made things worse.</p>
<div class="actions"><a class="btn primary" href="docs/quickstart/">Get started</a><a class="btn ghost" href="sample/">See a sample report</a></div>
${install("npx behavtest init --ts && npx behavtest run behavtest/suite.mts")}
<p class="note">No API key needed to try it. Requires Node.js 24 or newer.</p>
</div>
<figure class="term" aria-label="Example: behavtest compare output">
<div class="bar"><i></i><i></i><i></i><span>behavtest compare</span></div>
<pre class="plain"><span class="d">$</span> npx behavtest compare --fail-on-regression
<span class="b">behavtest compare · support-bot</span>
<span class="d">  base  f033e1c8  prompt-v6
  head  22ec5145  prompt-v7</span>

  <span class="r">✗ regressed</span> author-of-hamlet   5/5 → 0/5  <span class="r">p=0.008 significant</span>
  <span class="r">✗ regressed</span> symbol-for-gold    5/5 → 2/5  <span class="d">p=0.167</span>
  <span class="g">✓ improved </span> is-pluto-a-planet  0/5 → 5/5  <span class="g">p=0.008 significant</span>
  <span class="y">~ flaky    </span> largest-ocean      3/5 → 3/5

  overall  -21.7 pts  <span class="d">95% CI [-28.3, -15.0]  p=0.0015</span>
  <span class="r b">→ significant regression · gate failed</span></pre>
</figure>
</div></section>

<div class="band"><div class="wrap">
<span class="label">Tests</span>
<span class="chip">Any HTTP service</span><span class="chip">Python · FastAPI · LangChain</span><span class="chip">OpenAI</span><span class="chip">Anthropic Claude</span><span class="chip">Azure · Ollama · vLLM · OpenRouter</span><span class="chip">TypeScript functions</span>
</div></div>

<section class="block" id="features"><div class="wrap">
<p class="eyebrow">What it does</p>
<h2>Know whether a change made your AI behave worse</h2>
<p class="sub">A prompt tweak, a model swap or a new retrieval setting can quietly change how your application behaves. BehavTest turns that into a behavioral regression test you run locally and in CI.</p>
<div class="grid">
${feature("run", "Test the real pipeline", "An HTTP endpoint in any language, an OpenAI-compatible or Anthropic model, or a function in your own process.", "docs/adapters/")}
${feature("check", "Score every answer", "Exact match, a prompt-injection-hardened LLM judge, latency and cost limits, or your own scorers in TypeScript.", "docs/scorers/")}
${feature("stats", "Tell regressions from noise", "Repeat each case, then compare runs with Wilson intervals, Fisher's exact test and a case-stratified permutation test.", "docs/compare/")}
${feature("pr", "Fail the pull request", "A GitHub Action compares every pull request with a committed baseline and fails the check when quality drops.", "docs/github-action/")}
${feature("trace", "Check what the agent did", "Store each run's tool calls and LLM steps, and test that the agent called the right tool without looping.", "docs/traces/")}
${feature("local", "Zero infrastructure", "One CLI, one local SQLite file, and a local dashboard to browse it. No hosted service, no account, no telemetry, no default provider. MIT licensed.", "docs/security/")}
</div>
</div></section>

<section class="block" id="how-it-works"><div class="wrap">
<p class="eyebrow">How it works</p>
<h2>Three steps from prompt change to confident merge</h2>
<p class="sub">Suites are plain JSON you can commit, or TypeScript when you want to call your agent directly.</p>
<div class="grid steps">
<article class="step"><h3>Write a suite</h3><p>List your pipeline and the cases that matter, with the scorers for each.</p>
<pre><code>{
  "name": "support-bot",
  "pipeline": { "adapter": "openai",
    "config": { "model": "gpt-6-luna" } },
  "cases": [{
    "id": "refund-window",
    "input": "Return after 40 days?",
    "scorers": ["llmJudge"] }]
}</code></pre></article>
<article class="step"><h3>Run, change, compare</h3><p>Run before and after your change, a few attempts per case, and see what moved.</p>
<pre><code>behavtest run suite.json --repeat 5
# edit the prompt or swap the model
behavtest run suite.json --repeat 5
behavtest compare</code></pre></article>
<article class="step"><h3>Gate every pull request</h3><p>Commit a baseline once; CI fails the pull request that makes results worse.</p>
<pre><code>behavtest run suite.json \\
  --repeat 3 --compact \\
  --export behavtest.baseline.json
# then in CI:
behavtest compare \\
  behavtest.baseline.json \\
  --fail-on-regression</code></pre></article>
</div>
</div></section>

${section("learn", "Learn", "Testing AI applications, from first principles", "What regression testing means when outputs are nondeterministic, how it differs from evaluation, and how to do it in practice. Useful whether or not you use BehavTest.", learn)}${section("blog", "Blog", "Notes from building BehavTest", "Articles on behavioral regression testing and on the decisions behind BehavTest, newest first.", posts.slice(0, LATEST), `<p class="note"><a href="blog/">All posts</a> · <a href="blog/feed.xml">RSS feed</a></p>`)}${section("integrations", "Integrations", "Test the stack you already have", "Step-by-step setups for the providers and frameworks BehavTest works with, each with a working example.", integrations, `<p class="note"><a href="integrations/">All integrations</a></p>`)}${section("comparisons", "Comparisons", "How BehavTest relates to other tools", "Neutral, sourced comparisons with other LLM evaluation and testing tools, and when each approach fits.", comparisons, `<p class="note"><a href="comparisons/">All comparisons</a></p>`)}<section class="block" id="how-to-guides"><div class="wrap">
<p class="eyebrow">How-to guides</p>
<h2>Start from what you want to do</h2>
<p class="sub">Short, task-first guides with copy-paste examples.</p>
<ul class="links">${guides.map((p) => `<li><a href="${p.path}">${esc(p.title)}</a></li>`).join("")}</ul>
</div></section>

<section class="block" id="reference"><div class="wrap">
<p class="eyebrow">Reference</p>
<h2>Everything in detail</h2>
<p class="sub">The suite format, every adapter and scorer, the statistics, the CLI and the library API.</p>
<ul class="ref">${docs.map((p) => `<li><a href="${p.path}">${esc(p.title)}</a></li>`).join("")}</ul>
</div></section>

<section class="final">
<h2>Try it in one command</h2>
<p>A working suite with a stand-in agent. No API key, no server, no account.</p>
${install("npx behavtest init --ts && npx behavtest run behavtest/suite.mts")}
</section>
</main>`;
}

const BLOG_DESCRIPTION = "Articles on behavioral regression testing for AI applications, and on the decisions behind BehavTest, newest first.";

/** /blog/: every post, newest first, with its date, description and topics. */
function blogIndex(posts: Page[]): string {
  const page: Page = { path: "blog/", title: "Blog", heading: "Blog", body: "", kind: "blog", description: BLOG_DESCRIPTION };
  const up = upFrom(page);
  const items = posts
    .map(
      (p) => `<article class="post">
<h2><a href="${up}${p.path}">${esc(p.title)}</a></h2>
<p class="byline"><time datetime="${p.date}">${longDate(p.date!)}</time> · ${p.topics!.map(esc).join(", ")}</p>
<p>${esc(p.description!)}</p>
</article>`,
    )
    .join("\n");
  const content = `<main class="doc">
<p class="crumbs"><a href="${up}">BehavTest</a></p>
<h1>Blog</h1>
<p>${esc(BLOG_DESCRIPTION)} Follow along with the <a href="feed.xml">RSS feed</a>.</p>
${items}
</main>`;
  const head =
    jsonLd({
      "@context": "https://schema.org",
      "@type": "Blog",
      name: "BehavTest blog",
      description: BLOG_DESCRIPTION,
      url: `${SITE}/blog/`,
      isPartOf: `${SITE}/`,
      blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${SITE}/${p.path}`, datePublished: p.date })),
    }) +
    jsonLd({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "BehavTest", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog/` },
      ],
    });
  return layout(page, content, head, { blog: true });
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cdata = (s: string) => `<![CDATA[${s.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
const rfc822 = (d: string) => new Date(`${d}T00:00:00Z`).toUTCString();

/** RSS 2.0 with each post's full content (absolute links and images), for readers and for dev.to / Hashnode imports. */
function rssFeed(posts: Page[], bodies: Map<string, string>): string {
  const items = posts
    .map(
      (p) => `    <item>
      <title>${xml(p.title)}</title>
      <link>${SITE}/${p.path}</link>
      <guid isPermaLink="true">${SITE}/${p.path}</guid>
      <pubDate>${rfc822(p.date!)}</pubDate>
      <dc:creator>${xml(pkg.author)}</dc:creator>
${p.topics!.map((t) => `      <category>${xml(t)}</category>`).join("\n")}
      <description>${xml(p.description!)}</description>
      <content:encoded>${cdata(bodies.get(p.path)!.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, ""))}</content:encoded>
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>BehavTest blog</title>
    <link>${SITE}/blog/</link>
    <description>${xml(BLOG_DESCRIPTION)}</description>
    <language>en</language>
    <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${rfc822(posts[0]!.date!)}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

/** llms.txt with a "## Blog" section listing the posts, newest first, before "## Optional" (or at the end). */
export function llmsWithBlog(llms: string, pages: Page[]): string {
  const posts = pages.filter((p) => p.kind === "blog");
  if (posts.length === 0) return llms;
  const section = `## Blog\n\nAll posts: ${SITE}/blog/ (RSS: ${SITE}/blog/feed.xml)\n\n${posts.map((p) => `- [${p.title}](${SITE}/${p.path}) (${p.date}): ${p.description}`).join("\n")}\n\n`;
  const at = llms.indexOf("\n## Optional");
  return at === -1 ? `${llms.trimEnd()}\n\n${section}` : `${llms.slice(0, at + 1)}${section}${llms.slice(at + 1)}`;
}

export interface BuildOptions {
  /** Where site-static/ is: blog posts' social cards are checked for there. */
  staticDir?: string;
  /** The hand-written llms.txt to extend with the blog section. */
  llms?: string;
}

export function buildSite(
  readme: string,
  content: Page[] = loadContentPages(join(root, "pages")),
  opts: BuildOptions = {},
): Map<string, string> {
  const staticDir = opts.staticDir ?? join(root, "site-static");
  const pages = [...splitReadme(readme), ...content];
  const posts = pages.filter((p) => p.kind === "blog"); // newest first
  const blog = posts.length > 0;
  const paths = new Set(pages.map((p) => p.path).concat("sample/", "llms.txt", ...(blog ? ["blog/"] : [])));
  for (const p of content) if (pages.filter((q) => q.path === p.path).length > 1) throw new Error(`two pages use the path ${p.path}`);
  const anchors = anchorIndex(pages);
  const files = new Map<string, string>();
  // previous/next links stay within a group: README pages (guides, then reference), or one kind of content page
  const group = (p: Page) => (p.kind === "guide" || p.kind === "doc" ? "readme" : p.kind);
  /** Images in a page: root-relative under /blog/, a file in site-static/blog/; PNGs get their size. */
  const imageResolver = (page: Page): ImageMapper => (src) => {
    // root-relative and under /blog/, like links: "/blog/<slug>/shot.png" lives in site-static/blog/<slug>/
    if (!/^\/blog\/[a-z0-9-]+\/[\w.-]+\.(png|jpe?g|webp|gif)$/i.test(src)) {
      throw new Error(`image ${src} on ${page.path}: write it as /blog/<slug>/<file>.png (a file in site-static/blog/<slug>/)`);
    }
    const file = join(staticDir, src.slice(1));
    if (!existsSync(file)) throw new Error(`image ${src} on ${page.path}: site-static${src} does not exist`);
    return { src: upFrom(page) + src.slice(1), ...(/\.png$/i.test(src) ? pngSize(file) : {}) };
  };
  const rendered = new Map<string, string>(); // blog post path -> body HTML with absolute URLs, for the feed
  const absoluteLinker = (page: Page, a: Map<string, Page>, ps: Set<string>): LinkMapper => {
    const relative = linker(page, a, ps);
    return (href) => new URL(relative(href), `${SITE}/${page.path}`).href;
  };
  const absoluteImages = (page: Page): ImageMapper => (src) => {
    const img = imageResolver(page)(src);
    return { ...img, src: new URL(img.src, `${SITE}/${page.path}`).href };
  };
  for (const page of pages) {
    const link = linker(page, anchors, paths);
    let content: string;
    let head = "";
    let pager = "";
    let image: { url: string; alt: string } | undefined;
    if (page.kind === "home") {
      content = landing(pages);
      head = jsonLd({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "BehavTest",
        alternateName: "Regrade",
        description: "Behavioral regression testing for AI applications: run LLM app, AI agent and RAG pipeline test cases repeatedly, score the answers, compare runs with statistical tests, and fail CI when behavior regresses.",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Windows, macOS, Linux (Node.js 24+)",
        softwareVersion: pkg.version,
        license: "https://opensource.org/licenses/MIT",
        url: `${SITE}/`,
        downloadUrl: "https://www.npmjs.com/package/behavtest",
        codeRepository: REPO,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      });
    } else {
      const imageFor = imageResolver(page);
      const body = renderMarkdown(page.body, link, page.description ? imageFor : noImages); // only pages/ files have a description
      const ordered = pages.filter((p) => p.kind !== "home" && group(p) === group(page));
      const i = ordered.indexOf(page);
      const prev = ordered[i - 1];
      const next = ordered[i + 1];
      const up = upFrom(page);
      pager = `<nav class="pager" aria-label="Pages">${prev ? `<a href="${up}${prev.path}"><small>Previous</small>← ${esc(prev.label ?? prev.title)}</a>` : ""}${next ? `<a class="next" href="${up}${next.path}"><small>Next</small>${esc(next.label ?? next.title)} →</a>` : ""}</nav>`;
      content = docPage(page, body, pager);
      const crumbs = [...trail(page).filter(([, p]) => !p.startsWith("#")), [page.title, page.path] as [string, string]];
      const breadcrumbs = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE}/${p}` })),
      };
      let article: object = { "@context": "https://schema.org", "@type": "TechArticle", headline: page.title, description: page.description, url: `${SITE}/${page.path}`, about: "BehavTest", isPartOf: `${SITE}/` };
      if (page.kind === "blog") {
        const card = `og/blog/${basename(page.path)}.png`;
        if (!existsSync(join(staticDir, card))) {
          throw new Error(`blog post ${page.path} has no social card: run node scripts/og-image.mts ${basename(page.path)} (expects site-static/${card})`);
        }
        image = { url: `${SITE}/${card}`, alt: page.title };
        article = {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: page.title,
          description: page.description,
          datePublished: page.date,
          author: { "@type": "Person", name: pkg.author },
          image: image.url,
          keywords: page.topics!.join(", "),
          url: `${SITE}/${page.path}`,
          mainEntityOfPage: `${SITE}/${page.path}`,
          isPartOf: `${SITE}/`,
          about: "BehavTest",
        };
      }
      head = (page.path === "docs/faq/" ? jsonLd(faqLd(page.body)) : jsonLd(article)) + jsonLd(breadcrumbs);
    }
    files.set(`${page.path}index.html`, layout(page, content, head, { blog, ...(image ? { image: image.url, imageAlt: image.alt } : {}) }));
    if (page.kind === "blog") rendered.set(page.path, renderMarkdown(page.body, absoluteLinker(page, anchors, paths), absoluteImages(page)));
  }
  if (blog) {
    files.set("blog/index.html", blogIndex(posts));
    files.set("blog/feed.xml", rssFeed(posts, rendered));
  }
  const urls = [...pages.map((p) => `${SITE}/${p.path}`), ...(blog ? [`${SITE}/blog/`] : []), `${SITE}/sample/`];
  files.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`);
  files.set("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  files.set("favicon.svg", FAVICON_SVG);
  files.set("llms.txt", llmsWithBlog(opts.llms ?? readFileSync(join(root, "llms.txt"), "utf8"), pages));
  // GitHub Pages serves 404.html for any missing path, at any depth: <base> makes its links absolute
  const notFound: Page = {
    path: "",
    title: "Page not found",
    heading: "Page not found",
    body: "",
    kind: "doc",
    description: "This page does not exist. BehavTest: behavioral regression testing for AI applications. Start from the documentation home.",
  };
  const learnLinks = pages.filter((p) => p.kind === "learn").map((p) => `<li><a href="${p.path}">${esc(p.title)}</a></li>`).join("");
  files.set(
    "404.html",
    layout(
      notFound,
      `<main class="doc">\n<h1>Page not found</h1>\n<p>There is no page at this address. It may have moved: the documentation was reorganized when Regrade became BehavTest.</p>\n<ul><li><a href="./">Documentation home</a></li><li><a href="docs/quickstart/">Quickstart</a></li><li><a href="integrations/">Integrations</a></li><li><a href="docs/troubleshooting/">Troubleshooting</a></li></ul>\n<h2>Learn</h2>\n<ul>${learnLinks}</ul>\n</main>`,
      "",
      { notFound: true, blog },
    ),
  );
  return files;
}

// ---- CLI ----------------------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = buildSite(readFileSync(join(root, "README.md"), "utf8"));
  for (const [path, text] of files) {
    mkdirSync(dirname(join(outDir, path)), { recursive: true });
    writeFileSync(join(outDir, path), text);
  }
  copyFileSync(join(root, "site-static", "og-image.png"), join(outDir, "og-image.png"));
  if (existsSync(join(root, "site-static", "og"))) cpSync(join(root, "site-static", "og"), join(outDir, "og"), { recursive: true });
  if (existsSync(join(root, "site-static", "blog"))) cpSync(join(root, "site-static", "blog"), join(outDir, "blog"), { recursive: true });
  copyFileSync(join(root, "README.md"), join(outDir, "llms-full.txt"));
  process.stdout.write(`site: ${files.size} files + llms-full.txt → ${outDir}\n`);
}
