import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { errorMessage } from "../core/errors.js";
import { safeJson } from "../report/html/render.js";
import type { Store } from "../store/store.js";
import { API_PREFIX, ApiError, handleApi } from "./api.js";
import { renderDashboard } from "./page.js";

export interface DashboardServerOptions {
  store: Store;
  version: string;
  /** Interface to listen on. Default 127.0.0.1 (this machine only). */
  host?: string;
  /** Default 4800; 0 picks a free port. */
  port?: number;
  /** The database path, shown in the dashboard header. */
  db?: string;
}

export interface DashboardServer {
  server: Server;
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

/** Largest request body accepted (a label is well under 4 KB). */
export const MAX_BODY_BYTES = 16 * 1024;
const MAX_URL_CHARS = 4096;

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
export const isLoopback = (host: string): boolean => LOOPBACK.has(host) || /^127\./.test(host);

const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const COMMON_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

/** The hostname part of a Host header ("localhost:4800" → "localhost", "[::1]:4800" → "::1"). */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(1, end) : h;
  }
  const colon = h.lastIndexOf(":");
  return colon >= 0 && h.indexOf(":") === colon ? h.slice(0, colon) : h;
}

/**
 * DNS rebinding sends a page's own domain name in Host while resolving it to this machine. Only accept
 * names that cannot be rebound: localhost, IP literals, and the host the server was started with.
 */
export function hostAllowed(hostHeader: string | undefined, boundHost: string): boolean {
  if (!hostHeader) return false;
  const name = hostnameOf(hostHeader);
  return name === "localhost" || isIP(name) !== 0 || name === boundHost.toLowerCase();
}

/**
 * Writes must come from the dashboard itself. Browsers always send Origin on PUT and DELETE, so another
 * site's page is refused; tools without an Origin header (curl, scripts) are allowed.
 */
export function originAllowed(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (origin === undefined) return true;
  return hostHeader !== undefined && origin.toLowerCase() === `http://${hostHeader.toLowerCase()}`;
}

function send(res: ServerResponse, status: number, body: string, type: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...COMMON_HEADERS, "Content-Type": type, "Content-Length": String(Buffer.byteLength(body)), ...extra });
  res.end(body);
}

/** JSON with `<`, `>` and `&` escaped: harmless even if something ever treats it as HTML. */
function sendJson(res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  send(res, status, safeJson(value), "application/json; charset=utf-8", { "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", ...extra });
}

// after a refused body the connection is closed, so unread bytes never reach the next request
const sendError = (res: ServerResponse, status: number, message: string) =>
  sendJson(res, status, { error: { status, message } }, status === 413 ? { Connection: "close" } : {});

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_BODY_BYTES) {
      req.resume();
      reject(new ApiError(413, `Request body over ${MAX_BODY_BYTES} bytes.`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        req.removeAllListeners("data");
        req.resume(); // discard the rest; the reply closes the connection
        reject(new ApiError(413, `Request body over ${MAX_BODY_BYTES} bytes.`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Build the request handler (exported for tests that drive it without a socket). */
export function dashboardHandler(opts: { store: Store; version: string; host: string; db?: string }) {
  const page = renderDashboard({ version: opts.version, db: opts.db });
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const method = req.method ?? "GET";
      const rawUrl = req.url ?? "/";
      if (!hostAllowed(req.headers.host, opts.host)) {
        sendError(res, 421, "Unrecognised Host header. Open the dashboard at the address `regrade serve` printed.");
        return;
      }
      if (rawUrl.length > MAX_URL_CHARS) {
        sendError(res, 414, "URL too long.");
        return;
      }
      const url = new URL(rawUrl, "http://localhost");

      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (method !== "GET" && method !== "HEAD") {
          send(res, 405, "Method not allowed\n", "text/plain; charset=utf-8", { Allow: "GET, HEAD" });
          return;
        }
        send(res, 200, method === "HEAD" ? "" : page, "text/html; charset=utf-8", { "Content-Security-Policy": PAGE_CSP });
        return;
      }
      if (url.pathname !== API_PREFIX && !url.pathname.startsWith(`${API_PREFIX}/`)) {
        sendError(res, 404, "Not found.");
        return;
      }
      if (method !== "GET" && method !== "PUT" && method !== "DELETE") {
        sendError(res, 405, `${method} is not allowed.`);
        return;
      }
      let body: unknown;
      if (method !== "GET") {
        if (!originAllowed(req.headers.origin, req.headers.host)) {
          sendError(res, 403, "Cross-origin write refused.");
          return;
        }
        const text = await readBody(req);
        if (method === "PUT") {
          if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new ApiError(415, "Send the body as application/json.");
          try {
            body = JSON.parse(text);
          } catch {
            throw new ApiError(400, "The body is not valid JSON.");
          }
        }
      }
      const out = handleApi({ store: opts.store, version: opts.version }, { method, path: url.pathname.slice(API_PREFIX.length) || "/", query: url.searchParams, body });
      sendJson(res, out.status, out.json);
    } catch (err) {
      if (err instanceof ApiError) sendError(res, err.status, err.message);
      else {
        if (process.env.DEBUG) process.stderr.write(`regrade serve: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
        sendError(res, 500, `Internal error: ${errorMessage(err)}`);
      }
    }
  };
}

/** Start the dashboard server. Resolves once it is listening. */
export function startDashboard(opts: DashboardServerOptions): Promise<DashboardServer> {
  const host = opts.host ?? "127.0.0.1";
  const handler = dashboardHandler({ store: opts.store, version: opts.version, host, db: opts.db });
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 16 * 1024 }, (req, res) => {
    void handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 4800, host, () => {
      server.off("error", reject);
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 4800);
      const shown = host === "0.0.0.0" || host === "::" ? "localhost" : host.includes(":") ? `[${host}]` : host;
      resolve({
        server,
        host,
        port,
        url: `http://${shown}:${port}/`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
