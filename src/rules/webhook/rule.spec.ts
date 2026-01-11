import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearWebhookCache, webhook } from "./index";

const ctx = { fieldName: "test", fieldPath: "test", eventKey: "test::event" };

describe("webhook rule", () => {
  beforeEach(() => {
    clearWebhookCache();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fail when url is missing", async () => {
    const result = await webhook.validate("value", {}, ctx);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("WEBHOOK_MISSING_URL");
  });

  it("should pass when webhook returns 200", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    const result = await webhook.validate(
      "test-value",
      { url: "https://api.example.com/validate" },
      ctx,
    );
    expect(result.valid).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/validate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("should fail when webhook returns 400", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid value" }),
    } as unknown as Response);

    const result = await webhook.validate(
      "bad-value",
      { url: "https://api.example.com/validate" },
      ctx,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid value");
    expect(result.code).toBe("WEBHOOK_VALIDATION_FAILED");
  });

  it("should use message field from response if error is not present", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ message: "Validation failed" }),
    } as unknown as Response);

    const result = await webhook.validate(
      "value",
      { url: "https://api.example.com/validate" },
      ctx,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Validation failed");
  });

  it("should fallback to status code if response has no error message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);

    const result = await webhook.validate(
      "value",
      { url: "https://api.example.com/validate" },
      ctx,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Webhook returned 500");
  });

  it("should support GET method", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    await webhook.validate("value", { url: "https://api.example.com/check", method: "GET" }, ctx);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/check",
      expect.objectContaining({
        method: "GET",
        body: undefined,
      }),
    );
  });

  it("should support PUT method", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    await webhook.validate("value", { url: "https://api.example.com/check", method: "PUT" }, ctx);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/check",
      expect.objectContaining({
        method: "PUT",
      }),
    );
  });

  it("should include custom headers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    await webhook.validate(
      "value",
      {
        url: "https://api.example.com/validate",
        headers: { "X-Custom": "header-value" },
      },
      ctx,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/validate",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Custom": "header-value",
        }),
      }),
    );
  });

  it("should interpolate environment variables in url", async () => {
    process.env.TEST_API_HOST = "api.test.com";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    await webhook.validate("value", { url: "https://${TEST_API_HOST}/validate" }, ctx);
    expect(fetch).toHaveBeenCalledWith("https://api.test.com/validate", expect.any(Object));

    delete process.env.TEST_API_HOST;
  });

  it("should interpolate environment variables in headers", async () => {
    process.env.TEST_API_KEY = "secret-key-123";
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    await webhook.validate(
      "value",
      {
        url: "https://api.example.com/validate",
        headers: { Authorization: "Bearer ${TEST_API_KEY}" },
      },
      ctx,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/validate",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret-key-123",
        }),
      }),
    );

    delete process.env.TEST_API_KEY;
  });

  it("should handle timeout", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => {
      const error = new Error("Aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });

    const result = await webhook.validate(
      "value",
      {
        url: "https://api.example.com/validate",
        timeout: 100,
      },
      ctx,
    );

    expect(result.valid).toBe(false);
    expect(result.code).toBe("WEBHOOK_TIMEOUT");
    expect(result.error).toContain("100ms");
  });

  it("should handle network errors", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    const result = await webhook.validate(
      "value",
      { url: "https://api.example.com/validate" },
      ctx,
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("WEBHOOK_ERROR");
    expect(result.error).toContain("Network error");
  });

  it("should retry on failure", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("First attempt failed"))
      .mockRejectedValueOnce(new Error("Second attempt failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

    const result = await webhook.validate(
      "value",
      {
        url: "https://api.example.com/validate",
        retries: 2,
      },
      ctx,
    );

    expect(result.valid).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("should cache successful responses", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    await webhook.validate(
      "cached-value",
      {
        url: "https://api.example.com/validate",
        cache: 60000,
      },
      ctx,
    );

    await webhook.validate(
      "cached-value",
      {
        url: "https://api.example.com/validate",
        cache: 60000,
      },
      ctx,
    );

    // Should only call fetch once due to caching
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("should cache failed responses too", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Bad" }),
    } as unknown as Response);

    const result1 = await webhook.validate(
      "bad-value",
      {
        url: "https://api.example.com/validate",
        cache: 60000,
      },
      ctx,
    );

    const result2 = await webhook.validate(
      "bad-value",
      {
        url: "https://api.example.com/validate",
        cache: 60000,
      },
      ctx,
    );

    expect(result1.valid).toBe(false);
    expect(result2.valid).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("should not cache when cache is 0", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    await webhook.validate(
      "value",
      {
        url: "https://api.example.com/validate",
        cache: 0,
      },
      ctx,
    );

    await webhook.validate(
      "value",
      {
        url: "https://api.example.com/validate",
        cache: 0,
      },
      ctx,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("should send correct request body", async () => {
    let capturedBody: string | undefined;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      capturedBody = options?.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
      } as Response);
    });

    await webhook.validate("test-value", { url: "https://api.example.com/validate" }, ctx);

    expect(capturedBody).toBeDefined();
    const body = JSON.parse(capturedBody!);
    expect(body).toEqual({
      field: "test",
      value: "test-value",
      context: {
        eventKey: "test::event",
        fieldPath: "test",
      },
    });
  });
});
