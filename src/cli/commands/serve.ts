import { spawn } from "node:child_process";
import pc from "picocolors";
import { ConfigError, errorMessage } from "../../core/errors.js";
import { isLoopback, startDashboard } from "../../serve/server.js";
import { VERSION } from "../version.js";
import { openExistingStore } from "./common.js";
import { resolveDbPath } from "./run.js";

export interface ServeOptions {
  db?: string;
  port?: number;
  host?: string;
  open?: boolean;
}

export const DEFAULT_SERVE_PORT = 4800;

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", '""', url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsVerbatimArguments: process.platform === "win32" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // no browser to open: the URL is printed anyway
  }
}

/** Serve the dashboard until Ctrl+C. Resolves once the server has stopped. */
export async function serveCommand(o: ServeOptions): Promise<number> {
  const db = resolveDbPath(o.db);
  const host = o.host ?? "127.0.0.1";
  const store = openExistingStore(db);
  let dash;
  try {
    dash = await startDashboard({ store, version: VERSION, host, port: o.port ?? DEFAULT_SERVE_PORT, db });
  } catch (err) {
    store.close();
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") throw new ConfigError(`Port ${o.port ?? DEFAULT_SERVE_PORT} is in use. Pick another with --port <n>.`);
    if (code === "EADDRNOTAVAIL" || code === "ENOTFOUND") throw new ConfigError(`Cannot listen on host "${host}": ${errorMessage(err)}`);
    throw err;
  }
  process.stdout.write(`${pc.bold("behavtest serve")} · ${db}\n  dashboard → ${pc.cyan(dash.url)}\n  press Ctrl+C to stop\n`);
  if (!isLoopback(host)) {
    process.stderr.write(
      pc.yellow(
        `  ! listening on ${host}: anyone who can reach this machine on port ${dash.port} can read your runs (inputs, outputs, traces) and change labels. There is no login.\n`,
      ),
    );
  }
  if (o.open) openBrowser(dash.url);

  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      process.stdout.write("\nstopping…\n");
      void dash.close().then(() => {
        store.close();
        resolve();
      });
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}
