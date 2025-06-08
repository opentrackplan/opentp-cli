/**
 * Simple CLI logger
 * Using custom implementation instead of pino for better bundling compatibility
 */

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const levels: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

let currentLevel: LogLevel = (process.env.OPENTP_LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
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
      data = entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    }
  }

  const parts = [prefix, message, data].filter(Boolean);
  return parts.join(" ");
}

function log(level: LogLevel, obj: unknown, msg?: string): void {
  if (!shouldLog(level)) return;

  const output = formatMessage(level, obj, msg);

  if (level === "error" || level === "fatal") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
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
