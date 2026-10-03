import type { RuleContext, RuleResult } from "../rules/types";

/**
 * A webhook binding: `checks.bindings.<id>.webhook` in opentp.cli.yaml. Since 0.10.0 a plan cannot
 * define webhooks itself (`webhook` is a reserved check id); it refers to a binding by its id.
 */
export interface WebhookConfig {
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
  /** The params written in the plan for this check id (`true` for `ticket-exists: true`) */
  params: unknown;
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
 * `OPENTP_WEBHOOK_ENV` (names separated by commas or spaces). Unset or empty means none (0.10.0;
 * up to 0.9.x an unset variable allowed every variable).
 *
 * The list is read from the environment of the run, never from a file, so a change to the plan or
 * to opentp.cli.yaml (for example a pull request) cannot widen it. It limits which variables a check
 * can read, not where it sends them.
 */
export function getWebhookEnvAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.OPENTP_WEBHOOK_ENV ?? "").split(/[\s,]+/).filter(Boolean));
}

/**
 * Interpolates ${VAR_NAME} references. Variables outside the allowlist are not read and are
 * returned in `denied`.
 */
function interpolateEnv(value: string, allowlist: Set<string>, denied: Set<string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
    if (!allowlist.has(envVar)) {
      denied.add(envVar);
      return "";
    }
    return process.env[envVar] || "";
  });
}

/**
 * Interpolate env vars in headers
 */
function interpolateHeaders(
  headers: Record<string, string>,
  allowlist: Set<string>,
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
function getCacheKey(url: string, value: unknown, params: unknown, fieldPath: string): string {
  return `${url}:${fieldPath}:${JSON.stringify(value)}:${JSON.stringify(params)}`;
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
 * Runs a webhook binding for one value: sends it to the bound URL; a 2xx response means valid,
 * anything else invalid.
 *
 * Config (`checks.bindings.<id>.webhook` in opentp.cli.yaml):
 *   url: string (required) - webhook URL, supports ${ENV_VAR}
 *   method: 'GET' | 'POST' | 'PUT' (default: 'POST')
 *   headers: Record<string, string> - HTTP headers, supports ${ENV_VAR}
 *   (${ENV_VAR} only for the names listed in OPENTP_WEBHOOK_ENV)
 *   timeout: number (default: 5000) - request timeout in ms
 *   retries: number (default: 0) - number of retries on failure
 *   cache: number (default: 0) - cache TTL in ms, 0 = no cache
 *
 * `params` (the value written in the plan for the check id) is sent as the `params` member of the
 * request body.
 */
export async function callWebhook(
  value: unknown,
  config: WebhookConfig,
  context: RuleContext,
  params: unknown = true,
): Promise<RuleResult> {
  if (!config?.url) {
    return {
      valid: false,
      error: 'Webhook binding requires "url"',
      code: "WEBHOOK_MISSING_URL",
    };
  }

  const allowlist = getWebhookEnvAllowlist();
  const denied = new Set<string>();
  const url = interpolateEnv(config.url, allowlist, denied);
  const method = config.method || "POST";
  const headers = config.headers ? interpolateHeaders(config.headers, allowlist, denied) : {};
  if (denied.size > 0) {
    const names = [...denied].join(", ");
    return {
      valid: false,
      error: `Webhook check uses environment variables that OPENTP_WEBHOOK_ENV does not allow: ${names}. No request was sent (set OPENTP_WEBHOOK_ENV=${[...denied].join(",")} in the environment of the run to allow them)`,
      code: "WEBHOOK_ENV_NOT_ALLOWED",
    };
  }
  const timeout = config.timeout ?? 5000;
  const retries = config.retries ?? 0;
  const cacheTTL = config.cache ?? 0;

  // Check cache
  if (cacheTTL > 0) {
    const cacheKey = getCacheKey(url, value, params, context.fieldPath);
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.result;
    }
  }

  // Build request body
  const body: WebhookRequestBody = {
    field: context.fieldName,
    value,
    params,
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
      const cacheKey = getCacheKey(url, value, params, context.fieldPath);
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
}

/**
 * Clear webhook response cache (useful for testing)
 */
export function clearWebhookCache(): void {
  responseCache.clear();
}
