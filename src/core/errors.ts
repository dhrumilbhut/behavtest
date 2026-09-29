export class BehavTestError extends Error {
  readonly code: string;
  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Invalid suite, missing env var, bad flag: detected before any case runs. Exit code 2. */
export class ConfigError extends BehavTestError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "CONFIG", options);
  }
}

/** A pipeline/provider call failed. */
export class AdapterError extends BehavTestError {
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(
    message: string,
    opts: { retryable?: boolean; status?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, "ADAPTER", { cause: opts.cause });
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/** The LLM judge could not produce a valid verdict. Always fails closed. */
export class JudgeError extends BehavTestError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "JUDGE", options);
  }
}

/**
 * The base error class under the project's former name.
 * @deprecated Use `BehavTestError`. This alias is the same class, so `instanceof` keeps working.
 */
export const RegradeError = BehavTestError;
/** @deprecated Use `BehavTestError`. */
export type RegradeError = BehavTestError;

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
