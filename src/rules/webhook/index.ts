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
 * Interpolate environment variables in a string
 * Supports ${VAR_NAME} syntax
 */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    return process.env[envVar] || "";
  });
}

/**
 * Interpolate env vars in headers
 */
function interpolateHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = interpolateEnv(value);
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
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
      }
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
 *   url: string (required) - webhook URL
 *   method: 'GET' | 'POST' | 'PUT' (default: 'POST')
 *   headers: Record<string, string> - HTTP headers, supports ${ENV_VAR}
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

    const url = interpolateEnv(config.url);
    const method = config.method || "POST";
    const headers = config.headers ? interpolateHeaders(config.headers) : {};
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
}
