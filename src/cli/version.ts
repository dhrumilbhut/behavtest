declare const __BEHAVTEST_VERSION__: string | undefined;

/** Injected at build time by tsup; falls back when running from source (tests, tsx). */
export const VERSION: string = typeof __BEHAVTEST_VERSION__ === "string" ? __BEHAVTEST_VERSION__ : "0.0.0-dev";
