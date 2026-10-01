#!/usr/bin/env node
// Renders a blog post's social card: site-static/og-blog.html filled with the post's title, date
// and topics, screenshotted at 1200x630 by a headless Edge or Chrome into
// site-static/og/blog/<slug>.png. The site build refuses a post without its card.
//
//   node scripts/og-image.mts <slug>       one post (pages/blog/<slug>.md)
//   node scripts/og-image.mts --all        every post that has no card yet
//
// The browser is found in the usual install locations; set OG_BROWSER to a path to override.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadContentPages, pngSize } from "./site.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cardsDir = join(root, "site-static", "og", "blog");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

function findBrowser(): string {
  const candidates = [
    process.env.OG_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error("No Edge or Chrome found: set OG_BROWSER to the browser's executable.");
  return found;
}

export function cardHtml(post: { title: string; date: string; topics: string[] }): string {
  const template = readFileSync(join(root, "site-static", "og-blog.html"), "utf8");
  const size = post.title.length > 70 ? 50 : post.title.length > 45 ? 58 : 66;
  const html = template
    .replaceAll("{{title}}", esc(post.title))
    .replaceAll("{{date}}", esc(longDate(post.date)))
    .replaceAll("{{topics}}", post.topics.slice(0, 3).map((t) => `<b>${esc(t)}</b>`).join(""))
    .replaceAll("{{size}}", String(size));
  const left = /\{\{\w+\}\}/.exec(html);
  if (left) throw new Error(`site-static/og-blog.html has a placeholder nothing fills: ${left[0]}`);
  return html;
}

function render(slug: string, post: { title: string; date: string; topics: string[] }, browser: string): string {
  mkdirSync(cardsDir, { recursive: true });
  const out = join(cardsDir, `${slug}.png`);
  const work = mkdtempSync(join(tmpdir(), "behavtest-og-"));
  try {
    const html = join(work, "card.html");
    writeFileSync(html, cardHtml(post));
    const r = spawnSync(
      browser,
      ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${join(work, "profile")}`, "--window-size=1200,630", `--screenshot=${out}`, pathToFileURL(html).href],
      { stdio: "ignore", timeout: 60_000 },
    );
    if (r.error) throw r.error;
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (!existsSync(out)) throw new Error(`the browser wrote no image for ${slug}`);
  const { width, height } = pngSize(out);
  if (width !== 1200 || height !== 630) throw new Error(`${out} is ${width}x${height}, expected 1200x630`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write("usage: node scripts/og-image.mts <slug> | --all\n");
    process.exit(2);
  }
  const posts = loadContentPages(join(root, "pages")).filter((p) => p.kind === "blog");
  const slugOf = (p: { path: string }) => basename(p.path);
  const todo = arg === "--all" ? posts.filter((p) => !existsSync(join(cardsDir, `${slugOf(p)}.png`))) : posts.filter((p) => slugOf(p) === arg);
  if (arg !== "--all" && todo.length === 0) {
    process.stderr.write(`no blog post "${arg}" in pages/blog/\n`);
    process.exit(2);
  }
  const browser = todo.length ? findBrowser() : "";
  for (const p of todo) {
    const out = render(slugOf(p), { title: p.title, date: p.date!, topics: p.topics! }, browser);
    process.stdout.write(`${out}\n`);
  }
  if (todo.length === 0) process.stdout.write("every blog post already has its card\n");
}
