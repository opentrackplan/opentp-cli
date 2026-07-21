import { describe, expect, it, vi } from "vitest";
import { Router } from "./router";

const noop = vi.fn();

describe("Router", () => {
  it("matches an exact path", () => {
    const router = new Router();
    router.get("/api/health", noop);

    const result = router.match("GET", "/api/health");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({});
  });

  it("returns null for non-matching path", () => {
    const router = new Router();
    router.get("/api/health", noop);

    expect(router.match("GET", "/api/unknown")).toBeNull();
  });

  it("returns null for non-matching method", () => {
    const router = new Router();
    router.get("/api/health", noop);

    expect(router.match("POST", "/api/health")).toBeNull();
  });

  it("extracts a single path param", () => {
    const router = new Router();
    router.get("/api/events/:key", noop);

    const result = router.match("GET", "/api/events/page_view");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ key: "page_view" });
  });

  it("extracts multiple path params", () => {
    const router = new Router();
    router.get("/api/:resource/:id", noop);

    const result = router.match("GET", "/api/events/123");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ resource: "events", id: "123" });
  });

  it("decodes URI-encoded param values", () => {
    const router = new Router();
    router.get("/api/events/:key", noop);

    const result = router.match("GET", "/api/events/hello%20world");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ key: "hello world" });
  });

  it("matches case-insensitive method", () => {
    const router = new Router();
    router.get("/api/health", noop);

    expect(router.match("get", "/api/health")).not.toBeNull();
  });

  it("registers POST routes via convenience method", () => {
    const router = new Router();
    router.post("/api/events", noop);

    expect(router.match("POST", "/api/events")).not.toBeNull();
    expect(router.match("GET", "/api/events")).toBeNull();
  });

  it("registers PUT routes via convenience method", () => {
    const router = new Router();
    router.put("/api/events/:key", noop);

    const result = router.match("PUT", "/api/events/abc");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ key: "abc" });
  });

  it("registers DELETE routes via convenience method", () => {
    const router = new Router();
    router.delete("/api/events/:key", noop);

    expect(router.match("DELETE", "/api/events/abc")).not.toBeNull();
  });

  it("does not match partial paths", () => {
    const router = new Router();
    router.get("/api/health", noop);

    expect(router.match("GET", "/api/health/extra")).toBeNull();
    expect(router.match("GET", "/api")).toBeNull();
  });

  it("matches URL-encoded slashes in params", () => {
    const router = new Router();
    router.get("/api/dictionaries/:key", noop);

    const result = router.match("GET", "/api/dictionaries/taxonomy%2Fareas");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ key: "taxonomy/areas" });
  });

  it("returns the correct handler", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const router = new Router();
    router.get("/a", handler1);
    router.get("/b", handler2);

    expect(router.match("GET", "/a")!.handler).toBe(handler1);
    expect(router.match("GET", "/b")!.handler).toBe(handler2);
  });
});
