/**
 * Simple CLI logger
 * Using custom implementation instead of pino for better bundling compatibility
 *
 * Every level is written to stderr, so that stdout carries only command output (the `--json`
 * document, the human validation report, generator output).
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const levels: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** Valid values of OPENTP_LOG_LEVEL, from most to least verbose */
export const LOG_LEVELS = Object.keys(levels) as LogLevel[];

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && Object.hasOwn(levels, value);
}

/**
 * Returns the OPENTP_LOG_LEVEL problem, or null when the variable is unset, empty or valid.
 * An invalid value is ignored by the logger (it keeps "info"); the CLI reports it as a usage error.
 */
export function getLogLevelEnvProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.OPENTP_LOG_LEVEL;
  if (value === undefined || value === "" || isLogLevel(value)) return null;
  return `Invalid OPENTP_LOG_LEVEL '${value}'. Expected one of: ${LOG_LEVELS.join(", ")}`;
}

const envLevel = process.env.OPENTP_LOG_LEVEL;
let currentLevel: LogLevel = isLogLevel(envLevel) ? envLevel : "info";

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
}

function serializeLogValue(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
    });
  }

  return JSON.stringify(value);
}

function formatMessage(level: LogLevel, obj: unknown, msg?: string): string {
  const prefix = {
    trace: "⋯",
    debug: "⋯",
    info: "",
    warn: "⚠",
    error: "✗",
    fatal: "✗✗",
  }[level];

  let message = msg || "";
  let data = "";

  if (typeof obj === "string") {
    message = obj;
  } else if (typeof obj === "object" && obj !== null) {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length > 0) {
      data = entries.map(([k, v]) => `${k}=${serializeLogValue(v)}`).join(" ");
    }
  }

  const parts = [prefix, message, data].filter(Boolean);
  return parts.join(" ");
}

function log(level: LogLevel, obj: unknown, msg?: string): void {
  if (!shouldLog(level)) return;

  // All levels go to stderr; stdout is reserved for command output
  console.error(formatMessage(level, obj, msg));
}

export const logger = {
  trace: (obj: unknown, msg?: string) => log("trace", obj, msg),
  debug: (obj: unknown, msg?: string) => log("debug", obj, msg),
  info: (obj: unknown, msg?: string) => log("info", obj, msg),
  warn: (obj: unknown, msg?: string) => log("warn", obj, msg),
  error: (obj: unknown, msg?: string) => log("error", obj, msg),
  fatal: (obj: unknown, msg?: string) => log("fatal", obj, msg),
  get level() {
    return currentLevel;
  },
  set level(l: LogLevel) {
    currentLevel = l;
  },
};

/**
 * Set log level dynamically
 */
export function setLogLevel(newLevel: LogLevel): void {
  currentLevel = newLevel;
}

/**
 * Check if debug logging is enabled
 */
export function isDebug(): boolean {
  return currentLevel === "debug" || currentLevel === "trace";
}
