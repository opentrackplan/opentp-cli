import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDictionaryMutation } from "./useDictionaryMutation";
import type { DictionaryDraft } from "../types";

describe("useDictionaryMutation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const fetchMock = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

  function mockFetchSuccess(response: unknown, status = 200) {
    fetchMock().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(response),
    });
  }

  function mockFetchError(errorMessage: string, status = 400) {
    fetchMock().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({ error: errorMessage }),
    });
  }

  function makeDraft(overrides: Partial<DictionaryDraft> = {}): DictionaryDraft {
    return {
      originalKey: "old_key",
      key: "old_key",
      type: "string",
      values: ["a", "b"],
      isDirty: false,
      ...overrides,
    };
  }

  it("creates a new dictionary when originalKey is null", async () => {
    mockFetchSuccess({ created: true, key: "new_dict", filePath: "dictionaries/new_dict.yaml" }, 201);

    const { result } = renderHook(() => useDictionaryMutation(""));

    let res: unknown;
    await act(async () => {
      res = await result.current.save(makeDraft({ originalKey: null, key: "new_dict" }));
    });

    expect(res).toEqual({ created: true, key: "new_dict", filePath: "dictionaries/new_dict.yaml" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/dictionaries",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updates existing dictionary with PUT when originalKey is set", async () => {
    mockFetchSuccess({ updated: true, key: "old_key", filePath: "dictionaries/old_key.yaml" });

    const { result } = renderHook(() => useDictionaryMutation(""));

    await act(async () => {
      await result.current.save(makeDraft());
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/dictionaries/old_key",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("sends new key in body for rename (PUT with different key)", async () => {
    mockFetchSuccess({ updated: true, key: "new_key", filePath: "dictionaries/new_key.yaml" });

    const { result } = renderHook(() => useDictionaryMutation(""));

    let res: unknown;
    await act(async () => {
      res = await result.current.save(makeDraft({ key: "new_key" }));
    });

    // Should PUT to the original key URL
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/dictionaries/old_key",
      expect.objectContaining({ method: "PUT" }),
    );

    // Body should contain the new key
    const callArgs = fetchMock().mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.key).toBe("new_key");

    // Result should have the new key
    expect(res).toEqual(expect.objectContaining({ key: "new_key" }));
  });

  it("encodes keys with slashes in the URL", async () => {
    mockFetchSuccess({ updated: true, key: "taxonomy/areas", filePath: "dictionaries/taxonomy/areas.yaml" });

    const { result } = renderHook(() => useDictionaryMutation(""));

    await act(async () => {
      await result.current.save(makeDraft({ originalKey: "taxonomy/areas", key: "taxonomy/areas" }));
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/dictionaries/taxonomy%2Fareas",
      expect.anything(),
    );
  });

  it("sets error state on failure", async () => {
    mockFetchError("Dictionary with key 'dup' already exists", 409);

    const { result } = renderHook(() => useDictionaryMutation(""));

    let res: unknown;
    await act(async () => {
      res = await result.current.save(makeDraft({ key: "dup" }));
    });

    expect(res).toBeNull();
    expect(result.current.error).toBe("Dictionary with key 'dup' already exists");
  });

  it("clears error state on clearError", async () => {
    mockFetchError("Some error");

    const { result } = renderHook(() => useDictionaryMutation(""));

    await act(async () => {
      await result.current.save(makeDraft());
    });

    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it("manages saving state correctly", async () => {
    let resolveFetch!: (value: unknown) => void;
    fetchMock().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = renderHook(() => useDictionaryMutation(""));

    expect(result.current.saving).toBe(false);

    let savePromise: Promise<unknown>;
    act(() => {
      savePromise = result.current.save(makeDraft());
    });

    expect(result.current.saving).toBe(true);

    await act(async () => {
      resolveFetch({
        ok: true,
        json: () => Promise.resolve({ updated: true, key: "old_key", filePath: "test" }),
      });
      await savePromise!;
    });

    expect(result.current.saving).toBe(false);
  });

  it("deletes dictionary", async () => {
    mockFetchSuccess({ deleted: true, key: "to_delete" });

    const { result } = renderHook(() => useDictionaryMutation(""));

    let res: unknown;
    await act(async () => {
      res = await result.current.remove("to_delete");
    });

    expect(res).toEqual({ deleted: true, key: "to_delete" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/dictionaries/to_delete",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
