import { logger } from "../../util/logger";
import type { RuleDefinition, RuleResult } from "../types";

interface WebhookParams {
  url: string;
  method?: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  cache?: number;
}

interface WebhookRequestBody {
  field: string;
  value: unknown;
  context: {
    eventKey: string;
    eventPath?: string;
    fieldPath: string;
  };
}

// Simple in-memory cache
const responseCache = new Map<string, { result: RuleResult; expires: number }>();

/**
 * The environment variables that webhook `url` and `headers` may reference, from
 * `OPENTP_WEBHOOK_ENV` (names separated by commas or spaces; empty = none). `null` when the variable
 * is not set: then every variable is still interpolated (the behaviour up to 0.9.0), with a warning.
 *
 * The list is read from the environment of the run, not from the plan, so a change to the plan (for
 * example a pull request) cannot widen it. It limits which variables a check can read, not where it
 * sends them: whoever can change the plan can still send a listed variable to a URL of their choice.
 */
export function getWebhookEnvAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> | null {
  const raw = env.OPENTP_WEBHOOK_ENV;
  if (raw === undefined) return null;
  return new Set(raw.split(/[\s,]+/).filter(Boolean));
}

/** Variables already warned about (once per run) */
const warnedVariables = new Set<string>();

/**
 * Interpolates ${VAR_NAME} references. Variables outside the allowlist are not read and are
 * returned in `denied`; without an allowlist each variable is read and warned about once.
 */
function interpolateEnv(value: string, allowlist: Set<string> | null, denied: Set<string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
    if (allowlist) {
      if (!allowlist.has(envVar)) {
        denied.add(envVar);
        return "";
      }
    } else if (!warnedVariables.has(envVar)) {
      warnedVariables.add(envVar);
      logger.warn(
        { variable: envVar },
        "A webhook check reads an environment variable, and OPENTP_WEBHOOK_ENV is not set: any change to the plan could send it to a URL of its choice. Set OPENTP_WEBHOOK_ENV to the variables webhook checks may use",
      );
    }
    return process.env[envVar] || "";
  });
}

/**
 * Interpolate env vars in headers
 */
function interpolateHeaders(
  headers: Record<string, string>,
  allowlist: Set<string> | null,
  denied: Set<string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = interpolateEnv(value, allowlist, denied);
  }
  return result;
}

/**
 * Generate cache key from request
 */
function getCacheKey(url: string, value: unknown, fieldPath: string): string {
  return `${url}:${fieldPath}:${JSON.stringify(value)}`;
}

/**
 * Make HTTP request with retry support
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number,
  timeout: number,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
      }
    } finally {
      // Also on failure: a pending timer would keep the process alive (the CLI sets exitCode and
      // waits for the event loop to drain instead of calling process.exit)
      clearTimeout(timeoutId);
    }
  }

  throw lastError;
}

/**
 * Webhook validation rule
 *
 * Sends value to external URL for validation.
 * 2xx response = valid, 4xx/5xx = invalid
 *
 * Params:
 *   url: string (required) - webhook URL, supports ${ENV_VAR}
 *   method: 'GET' | 'POST' | 'PUT' (default: 'POST')
 *   headers: Record<string, string> - HTTP headers, supports ${ENV_VAR}
 *   (${ENV_VAR} is limited to the names in OPENTP_WEBHOOK_ENV when that variable is set)
 *   timeout: number (default: 5000) - request timeout in ms
 *   retries: number (default: 0) - number of retries on failure
 *   cache: number (default: 0) - cache TTL in ms, 0 = no cache
 */
export const webhook: RuleDefinition = {
  name: "webhook",
  validate: async (value, params, context): Promise<RuleResult> => {
    // Parse params
    const config = params as WebhookParams;

    if (!config.url) {
      return {
        valid: false,
        error: 'Webhook rule requires "url" parameter',
        code: "WEBHOOK_MISSING_URL",
      };
    }

    const allowlist = getWebhookEnvAllowlist();
    const denied = new Set<string>();
    const url = interpolateEnv(config.url, allowlist, denied);
    const method = config.method || "POST";
    const headers = config.headers ? interpolateHeaders(config.headers, allowlist, denied) : {};
    if (denied.size > 0) {
      return {
        valid: false,
        error: `Webhook check uses environment variables that OPENTP_WEBHOOK_ENV does not allow: ${[...denied].join(", ")}. No request was sent`,
        code: "WEBHOOK_ENV_NOT_ALLOWED",
      };
    }
    const timeout = config.timeout ?? 5000;
    const retries = config.retries ?? 0;
    const cacheTTL = config.cache ?? 0;

    // Check cache
    if (cacheTTL > 0) {
      const cacheKey = getCacheKey(url, value, context.fieldPath);
      const cached = responseCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        return cached.result;
      }
    }

    // Build request body
    const body: WebhookRequestBody = {
      field: context.fieldName,
      value,
      context: {
        eventKey: context.eventKey,
        fieldPath: context.fieldPath,
      },
    };

    try {
      const response = await fetchWithRetry(
        url,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: method !== "GET" ? JSON.stringify(body) : undefined,
        },
        retries,
        timeout,
      );

      let result: RuleResult;

      if (response.ok) {
        result = { valid: true };
      } else {
        // Try to parse error from response body
        let errorMessage = `Webhook returned ${response.status}`;
        try {
          const responseBody = await response.json();
          if (responseBody.error) {
            errorMessage = responseBody.error;
          } else if (responseBody.message) {
            errorMessage = responseBody.message;
          }
        } catch {
          // Ignore JSON parse errors
        }

        result = {
          valid: false,
          error: errorMessage,
          code: "WEBHOOK_VALIDATION_FAILED",
        };
      }

      // Store in cache
      if (cacheTTL > 0) {
        const cacheKey = getCacheKey(url, value, context.fieldPath);
        responseCache.set(cacheKey, {
          result,
          expires: Date.now() + cacheTTL,
        });
      }

      return result;
    } catch (err) {
      const error = err as Error;

      if (error.name === "AbortError") {
        return {
          valid: false,
          error: `Webhook timeout after ${timeout}ms`,
          code: "WEBHOOK_TIMEOUT",
        };
      }

      return {
        valid: false,
        error: `Webhook error: ${error.message}`,
        code: "WEBHOOK_ERROR",
      };
    }
  },
};

/**
 * Clear webhook response cache (useful for testing)
 */
export function clearWebhookCache(): void {
  responseCache.clear();
  warnedVariables.clear();
}
