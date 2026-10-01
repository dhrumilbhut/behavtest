import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The documentation site is generated from README.md by scripts/site.mts. These checks are what a
// crawler (or an LLM following links) would trip over: broken links, raw Markdown, missing metadata.
const root = resolve(import.meta.dirname, "..", "..");
let out: string;
let pages: string[];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => relative(out, f).replace(/\\/g, "/");

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "behavtest-site-"));
  const r = spawnSync(process.execPath, [join(root, "scripts", "site.mts"), "--out", out], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  pages = walk(out).filter((f) => f.endsWith(".html"));
});
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("documentation site", () => {
  it("has a landing page, every how-to guide and the key reference pages", () => {
    const paths = pages.map(rel);
    expect(paths).toContain("index.html");
    for (const p of ["docs/quickstart", "docs/faq", "docs/ci-baselines", "docs/traces", "docs/compare", "docs/for-ai-assistants", "guides/fail-a-github-pull-request-when-llm-quality-drops"]) {
      expect(paths).toContain(`${p}/index.html`);
    }
    const guides = [...read(join(root, "README.md")).split(/^## How-to guides$/m)[1]!.split(/^## /m)[0]!.matchAll(/^### /gm)].length;
    expect(paths.filter((p) => p.startsWith("guides/"))).toHaveLength(guides);
  });

  it("every internal link resolves to a generated page, every #anchor to an id on that page, and every image to a file", () => {
    const broken: string[] = [];
    for (const page of pages) {
      for (const [, src] of read(page).matchAll(/<img src="([^"]+)"/g)) {
        if (!existsSync(resolve(dirname(page), src!))) broken.push(`${rel(page)}: image ${src} (no file)`);
      }
      for (const [, href] of read(page).matchAll(/href="([^"]+)"/g)) {
        if (/^(https?:|mailto:|data:)/.test(href!)) continue; // external, or the inline favicon
        const [path, anchor] = href!.split("#") as [string, string | undefined];
        if (path === "sample/" || path.endsWith("/sample/")) continue; // written by scripts/sample-report.mjs
        let target = path === "" ? page : resolve(dirname(page), path);
        if (path === "" || path.endsWith("/") || path === "." || path === "./") target = path === "" ? page : join(target, "index.html");
        if (!existsSync(target)) {
          broken.push(`${rel(page)}: ${href} (no file)`);
          continue;
        }
        if (anchor && target.endsWith(".html") && !read(target).includes(`id="${anchor}"`)) broken.push(`${rel(page)}: ${href} (no id)`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("no raw Markdown leaks into the text", () => {
    for (const page of pages) {
      const text = read(page).replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<pre>[\s\S]*?<\/pre>/g, "").replace(/<code>[\s\S]*?<\/code>/g, "");
      expect(text, rel(page)).not.toMatch(/\*\*|\]\(|```|^#+ /m);
    }
  });

  it("every page has a unique title, a description of search-snippet length, and a canonical URL", () => {
    const titles = new Set<string>();
    for (const page of pages.filter((p) => rel(p) !== "404.html")) {
      const html = read(page);
      const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
      // measured as search engines see it: entities decoded
      const description = (/<meta name="description" content="([^"]*)">/.exec(html)?.[1] ?? "")
        .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      expect(title, rel(page)).toBeTruthy();
      expect(titles.has(title!), `duplicate title ${title}`).toBe(false);
      titles.add(title!);
      expect(description.length, `${rel(page)} description`).toBeGreaterThan(40);
      expect(description.length, `${rel(page)} description`).toBeLessThanOrEqual(160);
      expect(html).toMatch(/<link rel="canonical" href="https:\/\/dhrumilbhut\.github\.io\/behavtest\/[^"]*">/);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('name="viewport"');
    }
  });

  it("publishes structured data: SoftwareApplication on the landing page, FAQPage with every README question", () => {
    const ld = (f: string) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(read(join(out, f)))![1]!);
    expect(ld("index.html")).toMatchObject({ "@type": "SoftwareApplication", name: "BehavTest", alternateName: "Regrade", offers: { price: "0" } });
    const faq = ld("docs/faq/index.html");
    const questions = [...read(join(root, "README.md")).split(/^## FAQ$/m)[1]!.split(/^## /m)[0]!.matchAll(/^\*\*(.+\?)\*\*$/gm)].map((m) => m[1]);
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity.map((q: { name: string }) => q.name)).toEqual(questions);
    expect(questions.length).toBeGreaterThanOrEqual(8);
    for (const q of faq.mainEntity) expect(q.acceptedAnswer.text.length).toBeGreaterThan(20);
  });

  it("writes a sitemap of every page, robots.txt, llms.txt and llms-full.txt", () => {
    const sitemap = read(join(out, "sitemap.xml"));
    for (const page of pages.filter((p) => rel(p) !== "404.html")) {
      const url = `https://dhrumilbhut.github.io/behavtest/${rel(page).replace(/index\.html$/, "")}`;
      expect(sitemap).toContain(`<loc>${url}</loc>`);
    }
    expect(read(join(out, "robots.txt"))).toContain("Sitemap: https://dhrumilbhut.github.io/behavtest/sitemap.xml");
    expect(read(join(out, "llms.txt"))).toMatch(/^# BehavTest\n\n> /);
    expect(read(join(out, "llms-full.txt"))).toBe(read(join(root, "README.md")));
  });

  it("supports light and dark themes: system preference by default, a toggle, and the saved choice applied before first paint", () => {
    for (const page of pages) {
      const html = read(page);
      expect(html, rel(page)).toContain('<button class="theme" id="theme" type="button"');
      const early = html.indexOf('localStorage.getItem("behavtest-theme")');
      expect(early, rel(page)).toBeGreaterThan(-1);
      expect(early, `${rel(page)}: theme must be applied before the stylesheet`).toBeLessThan(html.indexOf("<style>"));
      expect(html).toContain(':root[data-theme="dark"]');
      expect(html).toContain('@media (prefers-color-scheme: dark)');
      expect(html).toContain(':root:not([data-theme="light"])');
    }
  });

  it("the landing page leads with the definition, a copyable install command and the main sections", () => {
    const html = read(join(out, "index.html"));
    expect(html).toMatch(/<h1>Behavioral regression testing for <span>AI applications<\/span><\/h1>/);
    expect(html).toContain('<div class="install"><code>npx behavtest init --ts &amp;&amp; npx behavtest run behavtest/suite.mts</code></div>');
    for (const id of ["features", "how-it-works", "how-to-guides", "reference"]) expect(html).toContain(`id="${id}"`);
  });

  it("gives every page social preview tags and the site icon", () => {
    expect(existsSync(join(out, "favicon.svg"))).toBe(true);
    for (const page of pages) {
      const html = read(page);
      for (const tag of ['property="og:image"', 'property="og:title"', 'property="og:description"', 'name="twitter:card" content="summary_large_image"', 'name="twitter:title"', 'name="twitter:description"', 'name="twitter:image"']) {
        expect(html, `${rel(page)} ${tag}`).toContain(tag);
      }
      expect(html, rel(page)).toMatch(/<link rel="icon" type="image\/svg\+xml" href="(\.\/|(\.\.\/)*)favicon\.svg">/);
      if (rel(page) !== "404.html") expect(html, rel(page)).not.toContain('content="noindex"');
    }
  });

  it("has a 404 page that is not indexed and whose links work at any depth", () => {
    const html = read(join(out, "404.html"));
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<base href="https://dhrumilbhut.github.io/behavtest/">');
    expect(html).not.toContain('rel="canonical"');
    expect(read(join(out, "sitemap.xml"))).not.toContain("404");
  });

  it("escapes HTML in code examples", () => {
    const html = read(join(out, "docs", "ci-baselines", "index.html"));
    expect(html).toContain("&quot;$GITHUB_STEP_SUMMARY&quot;");
    expect(html).not.toMatch(/<pre><code[^>]*>[^<]*<(?!\/code)/);
  });
});

// Blog posts (pages/blog/<slug>.md): built from fixtures, since the repository may have none yet.
describe("documentation site: blog posts", () => {
  type SiteModule = {
    buildSite: (readme: string, content: unknown[], opts: { staticDir: string; llms: string }) => Map<string, string>;
    loadContentPages: (dir: string) => { kind: string; path: string }[];
  };
  let site: SiteModule;
  let files: Map<string, string>;
  const post = (slug: string, date: string, extra = "") =>
    `---\npath: blog/${slug}/\ntitle: Post ${slug}\ndescription: A test post called ${slug}, long enough to be a search snippet.\nkind: blog\ndate: ${date}\ntopics: [statistics, ci]\n${extra}---\n# Post ${slug}\n\nSee [LLM testing](/llm-testing/).\n`;
  const write = (base: string, rel: string, text: string | Buffer) => {
    mkdirSync(dirname(join(base, rel)), { recursive: true });
    writeFileSync(join(base, rel), text);
  };
  /** The first 24 bytes of a PNG: enough for the generator to read its size. */
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b, 0);
    b.write("IHDR", 12, "ascii");
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  const buildWith = (posts: Record<string, string>, cards: string[], images: string[] = []) => {
    const d = mkdtempSync(join(tmpdir(), "behavtest-blog-"));
    write(d, "pages/learn/llm-testing.md", "---\npath: llm-testing/\ntitle: LLM Testing\ndescription: A learning page for the fixture, long enough to be a search snippet.\nkind: learn\n---\n# LLM testing\n\nText.\n");
    for (const [slug, text] of Object.entries(posts)) write(d, `pages/blog/${slug}.md`, text);
    for (const slug of cards) write(d, `static/og/blog/${slug}.png`, Buffer.from("png"));
    for (const image of images) write(d, `static${image}`, png(640, 360));
    try {
      return site.buildSite(read(join(root, "README.md")), site.loadContentPages(join(d, "pages")), {
        staticDir: join(d, "static"),
        llms: "# BehavTest\n\n> Summary.\n\n## Docs\n\n- a\n\n## Optional\n\n- b\n",
      });
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  };

  beforeAll(async () => {
    site = (await import(pathToFileURL(join(root, "scripts", "site.mts")).href)) as SiteModule;
    files = buildWith({ "older-post": post("older-post", "2026-09-10"), "newer-post": post("newer-post", "2026-09-25") }, ["older-post", "newer-post"]);
  });
  it("renders each post at its own URL with a date, topics, BlogPosting data and its own social card", () => {
    const html = files.get("blog/newer-post/index.html")!;
    expect(html).toContain('<link rel="canonical" href="https://dhrumilbhut.github.io/behavtest/blog/newer-post/">');
    expect(html).toContain("<title>Post newer-post | BehavTest</title>");
    expect(html).toContain('<p class="byline"><time datetime="2026-09-25">25 September 2026</time> · Dhrumil Bhut · statistics, ci</p>');
    expect(html).toContain('<meta property="og:image" content="https://dhrumilbhut.github.io/behavtest/og/blog/newer-post.png">');
    expect(html).toContain('<meta name="twitter:image" content="https://dhrumilbhut.github.io/behavtest/og/blog/newer-post.png">');
    expect(html).toContain('<a href="../../llm-testing/">LLM testing</a>'); // depth-aware, validated link
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!);
    expect(ld).toMatchObject({ "@type": "BlogPosting", datePublished: "2026-09-25", keywords: "statistics, ci", image: "https://dhrumilbhut.github.io/behavtest/og/blog/newer-post.png" });
    expect(html).toContain('<p class="crumbs"><a href="../../">BehavTest</a> › <a href="../../blog/">Blog</a></p>');
  });

  it("lists posts newest first in a Blog section on the landing page, and pages through them in that order", () => {
    const home = files.get("index.html")!;
    const section = home.split('id="blog"')[1]!.split("</section>")[0]!;
    expect(section.indexOf("blog/newer-post/")).toBeGreaterThan(-1);
    expect(section.indexOf("blog/newer-post/")).toBeLessThan(section.indexOf("blog/older-post/"));
    expect(section).toContain('<time datetime="2026-09-10">10 September 2026</time>');
    expect(files.get("blog/newer-post/index.html")).toContain('<a class="next" href="../../blog/older-post/">');
  });

  it("adds posts to sitemap.xml and to a Blog section of llms.txt, before Optional", () => {
    for (const slug of ["newer-post", "older-post"]) expect(files.get("sitemap.xml")).toContain(`<loc>https://dhrumilbhut.github.io/behavtest/blog/${slug}/</loc>`);
    const llms = files.get("llms.txt")!;
    expect(llms).toMatch(/## Docs[\s\S]*## Blog\n\nAll posts: [^\n]+\n\n- \[Post newer-post\]\(https:\/\/dhrumilbhut\.github\.io\/behavtest\/blog\/newer-post\/\) \(2026-09-25\): [^\n]+\n- \[Post older-post\][^\n]+\n\n## Optional/);
  });

  it("has no Blog section, menu link, index page or feed, and leaves llms.txt as written, when there are no posts", () => {
    const none = buildWith({}, []);
    expect(none.get("index.html")).not.toContain('id="blog"');
    expect(none.get("llm-testing/index.html")).not.toContain("blog/");
    expect(none.has("blog/index.html")).toBe(false);
    expect(none.has("blog/feed.xml")).toBe(false);
    expect(none.get("llms.txt")).not.toContain("## Blog");
  });

  it("links the blog from the menu and footer of every page, and advertises the feed", () => {
    const page = files.get("llm-testing/index.html")!;
    expect(page).toContain('<a class="opt" href="../blog/">Blog</a>');
    expect(page).toContain('<link rel="alternate" type="application/rss+xml" title="BehavTest blog" href="../blog/feed.xml">');
    expect(files.get("index.html")).toContain('<a class="opt" href="blog/">Blog</a>');
    expect(files.get("404.html")).toContain('<a class="opt" href="./blog/">Blog</a>');
  });

  it("has a /blog/ page listing every post, newest first, with its date, description and topics", () => {
    const index = files.get("blog/index.html")!;
    expect(index).toContain("<title>Blog | BehavTest</title>");
    expect(index).toContain('<link rel="canonical" href="https://dhrumilbhut.github.io/behavtest/blog/">');
    expect(index.indexOf('href="../blog/newer-post/"')).toBeGreaterThan(-1);
    expect(index.indexOf('href="../blog/newer-post/"')).toBeLessThan(index.indexOf('href="../blog/older-post/"'));
    expect(index).toContain('<p class="byline"><time datetime="2026-09-25">25 September 2026</time> · statistics, ci</p>');
    expect(index).toContain("<p>A test post called newer-post, long enough to be a search snippet.</p>");
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(index)![1]!);
    expect(ld).toMatchObject({ "@type": "Blog", url: "https://dhrumilbhut.github.io/behavtest/blog/" });
    expect(ld.blogPost.map((b: { url: string }) => b.url)).toEqual([
      "https://dhrumilbhut.github.io/behavtest/blog/newer-post/",
      "https://dhrumilbhut.github.io/behavtest/blog/older-post/",
    ]);
    expect(files.get("sitemap.xml")).toContain("<loc>https://dhrumilbhut.github.io/behavtest/blog/</loc>");
    expect(files.get("llms.txt")).toContain("All posts: https://dhrumilbhut.github.io/behavtest/blog/ (RSS: https://dhrumilbhut.github.io/behavtest/blog/feed.xml)");
  });

  it("shows only the three newest posts on the landing page, with a link to all of them", () => {
    const four = buildWith(
      { a: post("a", "2026-09-01"), b: post("b", "2026-09-02"), c: post("c", "2026-09-03"), d: post("d", "2026-09-04") },
      ["a", "b", "c", "d"],
    );
    const section = four.get("index.html")!.split('id="blog"')[1]!.split("</section>")[0]!;
    expect([...section.matchAll(/<li><a href="blog\/(\w)\/"/g)].map((m) => m[1])).toEqual(["d", "c", "b"]);
    expect(section).toContain('<a href="blog/">All posts</a> · <a href="blog/feed.xml">RSS feed</a>');
    expect(four.get("blog/index.html")).toContain('href="../blog/a/"'); // the index still lists all four
  });

  it("publishes an RSS 2.0 feed with each post's full content, absolute links and images, newest first", () => {
    const withImage = post("shots", "2026-09-30", "").replace("See [LLM testing](/llm-testing/).", "See [LLM testing](/llm-testing/) & more.\n\n![A screenshot](/blog/shots/compare.png)").replace("title: Post shots", "title: Posts & <shots>");
    const feed = buildWith({ shots: withImage, "older-post": post("older-post", "2026-09-10") }, ["shots", "older-post"], ["/blog/shots/compare.png"]).get("blog/feed.xml")!;
    expect(feed).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0"/);
    expect(feed).toContain('<atom:link href="https://dhrumilbhut.github.io/behavtest/blog/feed.xml" rel="self" type="application/rss+xml"/>');
    expect(feed).toContain("<title>Posts &amp; &lt;shots&gt;</title>");
    expect(feed).toContain("<lastBuildDate>Wed, 30 Sep 2026 00:00:00 GMT</lastBuildDate>");
    expect(feed.indexOf("<link>https://dhrumilbhut.github.io/behavtest/blog/shots/</link>")).toBeLessThan(feed.indexOf("<link>https://dhrumilbhut.github.io/behavtest/blog/older-post/</link>"));
    expect(feed).toContain("<pubDate>Thu, 10 Sep 2026 00:00:00 GMT</pubDate>");
    expect(feed).toContain('<guid isPermaLink="true">https://dhrumilbhut.github.io/behavtest/blog/shots/</guid>');
    expect(feed).toContain("<category>statistics</category>");
    const content = /<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/.exec(feed)![1]!;
    expect(content).toContain('<a href="https://dhrumilbhut.github.io/behavtest/llm-testing/">LLM testing</a>');
    expect(content).toContain('<img src="https://dhrumilbhut.github.io/behavtest/blog/shots/compare.png"');
    expect(content).not.toContain("<h1"); // the item's title is the heading
    expect(content).not.toMatch(/(href|src)="\.\.\//);
  });

  it("refuses posts with a missing or impossible date, no topics, a path that isn't the file name, or no social card", () => {
    expect(() => buildWith({ p: post("p", "2026-09-31") }, ["p"])).toThrow(/needs "date: YYYY-MM-DD"/);
    expect(() => buildWith({ p: post("p", "30-09-2026") }, ["p"])).toThrow(/needs "date: YYYY-MM-DD"/);
    expect(() => buildWith({ p: post("p", "2026-09-30").replace("topics: [statistics, ci]\n", "") }, ["p"])).toThrow(/needs "topics/);
    expect(() => buildWith({ p: post("q", "2026-09-30") }, ["p", "q"])).toThrow(/path must be "blog\/p\/"/);
    expect(() => buildWith({ p: post("p", "2026-09-30") }, [])).toThrow(/has no social card: run node scripts\/og-image\.mts p/);
    expect(() => buildWith({ p: post("p", "2026-09-30").replace(/description: .*/, `description: ${"x".repeat(161)}`) }, ["p"])).toThrow(/max 160/);
  });

  it("renders an image line as a figure with its caption, a depth-aware src and the PNG's size", () => {
    const withImage = post("shots", "2026-09-30").replace("See [LLM testing](/llm-testing/).", "![The compare view, **demo data**](/blog/shots/compare.png)");
    const html = buildWith({ shots: withImage }, ["shots"], ["/blog/shots/compare.png"]).get("blog/shots/index.html")!;
    expect(html).toContain('<figure><img src="../../blog/shots/compare.png" alt="The compare view, **demo data**" width="640" height="360" loading="lazy" decoding="async"><figcaption>The compare view, <strong>demo data</strong></figcaption></figure>');
  });

  it("refuses an image that is missing, outside /blog/, or has no caption", () => {
    const withImage = (line: string) => post("shots", "2026-09-30").replace("See [LLM testing](/llm-testing/).", line);
    expect(() => buildWith({ shots: withImage("![Shot](/blog/shots/missing.png)") }, ["shots"])).toThrow(/site-static\/blog\/shots\/missing\.png does not exist/);
    expect(() => buildWith({ shots: withImage("![Shot](./assets/shot.png)") }, ["shots"])).toThrow(/write it as \/blog\/<slug>\/<file>\.png/);
    expect(() => buildWith({ shots: withImage("![](/blog/shots/compare.png)") }, ["shots"], ["/blog/shots/compare.png"])).toThrow(/write a caption/);
  });

  it("every post in the repository has its social card", () => {
    const blogDir = join(root, "pages", "blog");
    const slugs = existsSync(blogDir) ? readdirSync(blogDir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : [];
    for (const slug of slugs) expect(existsSync(join(root, "site-static", "og", "blog", `${slug}.png`)), slug).toBe(true);
  });
});
