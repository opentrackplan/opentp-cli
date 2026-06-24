import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerApiRoutes, taxonomyToFilePath } from "./api";
import { Router } from "./router";

// ── Mocks ─────────────────────────────────────────────────

vi.mock("../core/config", () => ({
  findConfigFile: vi.fn(),
  loadConfig: vi.fn(),
  getEventsPath: vi.fn(),
  getDictsPath: vi.fn(),
  getEventsTemplate: vi.fn(),
}));

vi.mock("../core/event", () => ({
  loadEvents: vi.fn(),
}));

vi.mock("../core/dict", () => ({
  loadDictionaries: vi.fn(),
}));

vi.mock("../core/validator", () => ({
  validateEvents: vi.fn(),
}));

vi.mock("../core/payload", () => ({
  resolveEventPayload: vi.fn(),
}));

vi.mock("../util/files", () => ({
  saveYaml: vi.fn(),
  ensureDir: vi.fn(),
  fileExists: vi.fn(),
  scanDirectory: vi.fn(() => new Map()),
  filterByExtension: vi.fn(() => []),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      unlinkSync: vi.fn(),
      readdirSync: vi.fn(() => ["something"]),
      rmdirSync: vi.fn(),
      readFileSync: vi.fn(() => ""),
      writeFileSync: vi.fn(),
    },
    unlinkSync: vi.fn(),
    readdirSync: vi.fn(() => ["something"]),
    rmdirSync: vi.fn(),
    readFileSync: vi.fn(() => ""),
    writeFileSync: vi.fn(),
  };
});

vi.mock("../meta", () => ({
  SPEC_VERSION: "2026-01",
}));

import {
  findConfigFile,
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  loadConfig,
} from "../core/config";
import { loadDictionaries } from "../core/dict";
import { loadEvents } from "../core/event";
import { resolveEventPayload } from "../core/payload";
import { validateEvents } from "../core/validator";
import { ensureDir, fileExists, filterByExtension, saveYaml, scanDirectory } from "../util/files";

// ── Helpers ───────────────────────────────────────────────

function mockReq(method: string, body?: unknown): IncomingMessage {
  const stream = new PassThrough() as unknown as IncomingMessage;
  stream.method = method;
  stream.headers = { host: "localhost:3000" };
  if (body !== undefined) {
    process.nextTick(() => {
      (stream as unknown as PassThrough).end(JSON.stringify(body));
    });
  } else {
    process.nextTick(() => {
      (stream as unknown as PassThrough).end();
    });
  }
  return stream;
}

function mockRes(): ServerResponse & { _status: number; _body: string } {
  const res = {
    _status: 200,
    _body: "",
    writeHead(status: number, _headers?: Record<string, string>) {
      res._status = status;
      return res;
    },
    end(data?: string) {
      res._body = data ?? "";
      return res;
    },
  };
  return res as unknown as ServerResponse & { _status: number; _body: string };
}

function parsed(res: ReturnType<typeof mockRes>): unknown {
  return JSON.parse(res._body);
}

// ── Tracking plan mock setup ──────────────────────────────

const MOCK_CONFIG = {
  opentp: "2026-01",
  info: { title: "Test Plan", version: "1.0.0" },
  spec: {
    paths: {
      events: { root: "/events", template: "{area}/{action}.yaml" },
      dictionaries: { root: "/dictionaries" },
    },
    targets: {},
    events: {
      taxonomy: {},
      payload: { targets: { all: ["web"] }, schema: {} },
    },
  },
};

const MOCK_EVENT = {
  filePath: "/root/events/auth/login.yaml",
  relativePath: "auth/login.yaml",
  opentp: "2026-01",
  key: "auth::login",
  expectedKey: null,
  taxonomy: { area: "auth", action: "login" },
  lifecycle: { status: "active" },
  aliases: [],
  ignore: [],
  payload: { schema: { event_name: { value: "login" } } },
};

function setupMocks() {
  vi.mocked(findConfigFile).mockReturnValue("/root/opentp.yaml");
  vi.mocked(loadConfig).mockReturnValue(MOCK_CONFIG as never);
  vi.mocked(getDictsPath).mockReturnValue("/root/dictionaries");
  vi.mocked(getEventsPath).mockReturnValue("/root/events");
  vi.mocked(getEventsTemplate).mockReturnValue("{area}/{action}.yaml");
  vi.mocked(loadDictionaries).mockReturnValue({
    dictionaries: new Map(),
    dictMeta: new Map(),
    issues: [],
  });
  vi.mocked(loadEvents).mockReturnValue([MOCK_EVENT] as never);
  vi.mocked(resolveEventPayload).mockReturnValue({
    payload: { targets: {} },
    issues: [],
  } as never);
  vi.mocked(validateEvents).mockResolvedValue([]);
  vi.mocked(fileExists).mockReturnValue(false);
}

// ── Tests ─────────────────────────────────────────────────

describe("API routes", () => {
  let router: Router;

  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
    router = new Router();
    registerApiRoutes(router, "/root");
  });

  // GET /api/config

  describe("GET /api/config", () => {
    it("returns the config object", async () => {
      const match = router.match("GET", "/api/config")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      expect((parsed(res) as { info: { title: string } }).info.title).toBe("Test Plan");
    });

    it("returns 500 when config not found", async () => {
      vi.mocked(findConfigFile).mockReturnValue(null);

      const match = router.match("GET", "/api/config")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(500);
      expect((parsed(res) as { error: string }).error).toContain("not found");
    });
  });

  // GET /api/events

  describe("GET /api/events", () => {
    it("returns event list with correct shape", async () => {
      const match = router.match("GET", "/api/events")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as Array<{ key: string; relativePath: string }>;
      expect(body).toHaveLength(1);
      expect(body[0].key).toBe("auth::login");
      expect(body[0].relativePath).toBe("auth/login.yaml");
      // Should not expose absolute filePath
      expect((body[0] as Record<string, unknown>).filePath).toBeUndefined();
    });
  });

  // GET /api/events/:key

  describe("GET /api/events/:key", () => {
    it("returns a single event with resolved payload", async () => {
      const match = router.match("GET", "/api/events/auth::login")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as Record<string, unknown>;
      expect(body.key).toBe("auth::login");
      expect(body.resolvedPayload).toBeDefined();
      expect(body.payloadIssues).toBeDefined();
      expect(resolveEventPayload).toHaveBeenCalled();
    });

    it("returns 404 for unknown key", async () => {
      const match = router.match("GET", "/api/events/unknown::key")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(404);
      expect((parsed(res) as { error: string }).error).toContain("not found");
    });
  });

  // POST /api/events

  describe("POST /api/events", () => {
    it("creates a new event and returns 201", async () => {
      const match = router.match("POST", "/api/events")!;
      const res = mockRes();
      await match.handler(
        mockReq("POST", {
          key: "test::new_event",
          taxonomy: { area: "test", action: "new_event" },
          payload: { schema: {} },
        }),
        res,
        match.params,
      );

      expect(res._status).toBe(201);
      const body = parsed(res) as { created: boolean; key: string; filePath: string };
      expect(body.created).toBe(true);
      expect(body.key).toBe("test::new_event");
      expect(saveYaml).toHaveBeenCalled();
      expect(ensureDir).toHaveBeenCalled();
    });

    it("returns 409 for duplicate key", async () => {
      const match = router.match("POST", "/api/events")!;
      const res = mockRes();
      await match.handler(
        mockReq("POST", {
          key: "auth::login",
          taxonomy: { area: "auth", action: "login" },
          payload: { schema: {} },
        }),
        res,
        match.params,
      );

      expect(res._status).toBe(409);
      expect((parsed(res) as { error: string }).error).toContain("already exists");
    });

    it("returns 409 when file already exists", async () => {
      vi.mocked(fileExists).mockReturnValue(true);

      const match = router.match("POST", "/api/events")!;
      const res = mockRes();
      await match.handler(
        mockReq("POST", {
          key: "test::new_event",
          taxonomy: { area: "test", action: "new_event" },
          payload: { schema: {} },
        }),
        res,
        match.params,
      );

      expect(res._status).toBe(409);
      expect((parsed(res) as { error: string }).error).toContain("already exists");
    });

    it("returns 400 when key is missing", async () => {
      const match = router.match("POST", "/api/events")!;
      const res = mockRes();
      await match.handler(mockReq("POST", { taxonomy: {}, payload: {} }), res, match.params);

      expect(res._status).toBe(400);
      expect((parsed(res) as { error: string }).error).toContain("key");
    });

    it("returns 400 when taxonomy is missing", async () => {
      const match = router.match("POST", "/api/events")!;
      const res = mockRes();
      await match.handler(mockReq("POST", { key: "test::event", payload: {} }), res, match.params);

      expect(res._status).toBe(400);
      expect((parsed(res) as { error: string }).error).toContain("taxonomy");
    });

    it("returns 400 when payload is missing", async () => {
      const match = router.match("POST", "/api/events")!;
      const res = mockRes();
      await match.handler(mockReq("POST", { key: "test::event", taxonomy: {} }), res, match.params);

      expect(res._status).toBe(400);
      expect((parsed(res) as { error: string }).error).toContain("payload");
    });

    it("returns 400 when key does not match configured pattern", async () => {
      vi.mocked(loadConfig).mockReturnValue({
        ...MOCK_CONFIG,
        spec: {
          ...MOCK_CONFIG.spec,
          events: {
            ...MOCK_CONFIG.spec.events,
            key: { pattern: "^[a-z0-9_]+::[a-z0-9_]+$" },
          },
        },
      } as never);

      const match = router.match("POST", "/api/events")!;
      const res = mockRes();
      await match.handler(
        mockReq("POST", {
          key: "INVALID KEY!!",
          taxonomy: { area: "test", action: "bad" },
          payload: { schema: {} },
        }),
        res,
        match.params,
      );

      expect(res._status).toBe(400);
      expect((parsed(res) as { error: string }).error).toContain("Invalid key format");
    });

    it("accepts valid key when pattern is configured", async () => {
      vi.mocked(loadConfig).mockReturnValue({
        ...MOCK_CONFIG,
        spec: {
          ...MOCK_CONFIG.spec,
          events: {
            ...MOCK_CONFIG.spec.events,
            key: { pattern: "^[a-z0-9_]+::[a-z0-9_]+$" },
          },
        },
      } as never);

      const match = router.match("POST", "/api/events")!;
      const res = mockRes();
      await match.handler(
        mockReq("POST", {
          key: "test::valid_key",
          taxonomy: { area: "test", action: "valid_key" },
          payload: { schema: {} },
        }),
        res,
        match.params,
      );

      expect(res._status).toBe(201);
    });
  });

  // PUT /api/events/:key

  describe("PUT /api/events/:key", () => {
    it("updates an existing event", async () => {
      const match = router.match("PUT", "/api/events/auth::login")!;
      const res = mockRes();
      await match.handler(
        mockReq("PUT", {
          taxonomy: { area: "auth", action: "login" },
          lifecycle: { status: "deprecated" },
        }),
        res,
        match.params,
      );

      expect(res._status).toBe(200);
      const body = parsed(res) as { updated: boolean; key: string };
      expect(body.updated).toBe(true);
      expect(body.key).toBe("auth::login");
      expect(saveYaml).toHaveBeenCalledWith(
        "/root/events/auth/login.yaml",
        expect.objectContaining({ opentp: "2026-01" }),
      );
    });

    it("returns 404 for unknown key", async () => {
      const match = router.match("PUT", "/api/events/unknown::key")!;
      const res = mockRes();
      await match.handler(mockReq("PUT", { taxonomy: {} }), res, match.params);

      expect(res._status).toBe(404);
    });

    it("merges partial taxonomy with existing event data", async () => {
      const match = router.match("PUT", "/api/events/auth::login")!;
      const res = mockRes();
      await match.handler(
        mockReq("PUT", {
          taxonomy: { action: "updated_login" },
        }),
        res,
        match.params,
      );

      expect(res._status).toBe(200);
      expect(saveYaml).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          event: expect.objectContaining({
            taxonomy: expect.objectContaining({
              area: "auth",
              action: "updated_login",
            }),
          }),
        }),
      );
    });

    it("preserves existing payload when not provided in update", async () => {
      const match = router.match("PUT", "/api/events/auth::login")!;
      const res = mockRes();
      await match.handler(
        mockReq("PUT", {
          taxonomy: { area: "auth", action: "login" },
        }),
        res,
        match.params,
      );

      expect(res._status).toBe(200);
      expect(saveYaml).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          event: expect.objectContaining({
            payload: MOCK_EVENT.payload,
          }),
        }),
      );
    });
  });

  // DELETE /api/events/:key

  describe("DELETE /api/events/:key", () => {
    it("deletes existing event and returns { deleted: true, key }", async () => {
      const match = router.match("DELETE", "/api/events/auth::login")!;
      const res = mockRes();
      await match.handler(mockReq("DELETE"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as { deleted: boolean; key: string };
      expect(body.deleted).toBe(true);
      expect(body.key).toBe("auth::login");
    });

    it("returns 404 for non-existent event key", async () => {
      const match = router.match("DELETE", "/api/events/unknown::key")!;
      const res = mockRes();
      await match.handler(mockReq("DELETE"), res, match.params);

      expect(res._status).toBe(404);
      expect((parsed(res) as { error: string }).error).toContain("not found");
    });

    it("removes YAML file from disk (verify mock)", async () => {
      const fs = await import("node:fs");

      const match = router.match("DELETE", "/api/events/auth::login")!;
      const res = mockRes();
      await match.handler(mockReq("DELETE"), res, match.params);

      expect(res._status).toBe(200);
      expect(fs.unlinkSync).toHaveBeenCalledWith("/root/events/auth/login.yaml");
    });

    it("removes empty parent directory after last event deleted", async () => {
      const fs = await import("node:fs");
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

      const match = router.match("DELETE", "/api/events/auth::login")!;
      const res = mockRes();
      await match.handler(mockReq("DELETE"), res, match.params);

      expect(res._status).toBe(200);
      expect(fs.rmdirSync).toHaveBeenCalledWith("/root/events/auth");
    });

    it("does not remove parent directory if other events exist", async () => {
      const fs = await import("node:fs");
      vi.mocked(fs.readdirSync).mockReturnValue(["other.yaml"] as unknown as ReturnType<
        typeof fs.readdirSync
      >);

      const match = router.match("DELETE", "/api/events/auth::login")!;
      const res = mockRes();
      await match.handler(mockReq("DELETE"), res, match.params);

      expect(res._status).toBe(200);
      expect(fs.rmdirSync).not.toHaveBeenCalled();
    });

    it("handles keys with double colons correctly", async () => {
      const doubleColonEvent = {
        ...MOCK_EVENT,
        key: "area::sub::action",
        filePath: "/root/events/area/sub_action.yaml",
      };
      vi.mocked(loadEvents).mockReturnValue([doubleColonEvent] as never);

      const match = router.match("DELETE", "/api/events/area::sub::action")!;
      const res = mockRes();
      await match.handler(mockReq("DELETE"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as { deleted: boolean; key: string };
      expect(body.deleted).toBe(true);
      expect(body.key).toBe("area::sub::action");
    });
  });

  // GET /api/dictionaries

  describe("GET /api/dictionaries", () => {
    it("returns dictionaries with type and values", async () => {
      const dictMap = new Map<string, (string | number | boolean)[]>();
      dictMap.set("taxonomy/areas", ["auth", "dashboard"]);
      const dictMeta = new Map<
        string,
        { type: "string" | "number" | "integer" | "boolean"; values: (string | number | boolean)[] }
      >();
      dictMeta.set("taxonomy/areas", { type: "string", values: ["auth", "dashboard"] });
      vi.mocked(loadDictionaries).mockReturnValue({
        dictionaries: dictMap,
        dictMeta,
        issues: [],
      });

      const match = router.match("GET", "/api/dictionaries")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as {
        dictionaries: Record<string, { type: string; values: string[] }>;
        issues: unknown[];
      };
      expect(body.dictionaries["taxonomy/areas"]).toEqual({
        type: "string",
        values: ["auth", "dashboard"],
      });
      expect(body.issues).toEqual([]);
    });
  });

  // GET /api/dictionaries/:key

  describe("GET /api/dictionaries/:key", () => {
    it("returns a single dictionary by key", async () => {
      const dictMeta = new Map([
        ["taxonomy/areas", { type: "string" as const, values: ["auth", "dashboard"] }],
      ]);
      vi.mocked(loadDictionaries).mockReturnValue({
        dictionaries: new Map([["taxonomy/areas", ["auth", "dashboard"]]]),
        dictMeta,
        issues: [],
      });

      const match = router.match("GET", "/api/dictionaries/taxonomy%2Fareas")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as { key: string; type: string; values: string[] };
      expect(body.key).toBe("taxonomy/areas");
      expect(body.type).toBe("string");
      expect(body.values).toEqual(["auth", "dashboard"]);
    });

    it("returns 404 for unknown dictionary key", async () => {
      const match = router.match("GET", "/api/dictionaries/unknown%2Fkey")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(404);
      expect((parsed(res) as { error: string }).error).toContain("not found");
    });
  });

  // POST /api/dictionaries

  describe("POST /api/dictionaries", () => {
    it("creates a new dictionary and returns 201", async () => {
      const match = router.match("POST", "/api/dictionaries")!;
      const res = mockRes();
      await match.handler(
        mockReq("POST", {
          key: "taxonomy/areas",
          type: "string",
          values: ["auth", "dashboard"],
        }),
        res,
        match.params,
      );

      expect(res._status).toBe(201);
      const body = parsed(res) as { created: boolean; key: string };
      expect(body.created).toBe(true);
      expect(body.key).toBe("taxonomy/areas");
      expect(saveYaml).toHaveBeenCalled();
      expect(ensureDir).toHaveBeenCalled();
    });

    it("returns 409 for duplicate key", async () => {
      const dictMap = new Map([["taxonomy/areas", ["auth"]]]);
      const dictMeta = new Map([["taxonomy/areas", { type: "string" as const, values: ["auth"] }]]);
      vi.mocked(loadDictionaries).mockReturnValue({ dictionaries: dictMap, dictMeta, issues: [] });

      const match = router.match("POST", "/api/dictionaries")!;
      const res = mockRes();
      await match.handler(
        mockReq("POST", { key: "taxonomy/areas", type: "string", values: ["auth"] }),
        res,
        match.params,
      );

      expect(res._status).toBe(409);
    });

    it("returns 400 when key is missing", async () => {
      const match = router.match("POST", "/api/dictionaries")!;
      const res = mockRes();
      await match.handler(mockReq("POST", { type: "string", values: [] }), res, match.params);

      expect(res._status).toBe(400);
      expect((parsed(res) as { error: string }).error).toContain("key");
    });

    it("returns 400 when values is not an array", async () => {
      const match = router.match("POST", "/api/dictionaries")!;
      const res = mockRes();
      await match.handler(
        mockReq("POST", { key: "new/dict", type: "string", values: "not-array" }),
        res,
        match.params,
      );

      expect(res._status).toBe(400);
      expect((parsed(res) as { error: string }).error).toContain("values");
    });

    it("rejects path traversal in key", async () => {
      const match = router.match("POST", "/api/dictionaries")!;
      const res = mockRes();
      await match.handler(
        mockReq("POST", { key: "../etc/passwd", type: "string", values: [] }),
        res,
        match.params,
      );

      expect(res._status).toBe(400);
    });
  });

  // PUT /api/dictionaries/:key

  describe("PUT /api/dictionaries/:key", () => {
    it("updates an existing dictionary", async () => {
      const dictMap = new Map([["taxonomy/areas", ["auth"]]]);
      const dictMeta = new Map([["taxonomy/areas", { type: "string" as const, values: ["auth"] }]]);
      vi.mocked(loadDictionaries).mockReturnValue({ dictionaries: dictMap, dictMeta, issues: [] });

      const match = router.match("PUT", "/api/dictionaries/taxonomy%2Fareas")!;
      const res = mockRes();
      await match.handler(mockReq("PUT", { values: ["auth", "dashboard"] }), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as { updated: boolean; key: string };
      expect(body.updated).toBe(true);
      expect(body.key).toBe("taxonomy/areas");
      expect(saveYaml).toHaveBeenCalled();
    });

    it("returns 404 for unknown key", async () => {
      const match = router.match("PUT", "/api/dictionaries/unknown%2Fkey")!;
      const res = mockRes();
      await match.handler(mockReq("PUT", { values: [] }), res, match.params);

      expect(res._status).toBe(404);
    });

    it("renames dictionary when body contains a different key", async () => {
      const fs = await import("node:fs");
      const dictMap = new Map([["old_name", ["a", "b"]]]);
      const dictMeta = new Map([["old_name", { type: "string" as const, values: ["a", "b"] }]]);
      vi.mocked(loadDictionaries).mockReturnValue({ dictionaries: dictMap, dictMeta, issues: [] });
      vi.mocked(fileExists).mockReturnValue(false);

      const match = router.match("PUT", "/api/dictionaries/old_name")!;
      const res = mockRes();
      await match.handler(
        mockReq("PUT", { key: "new_name", type: "string", values: ["a", "b"] }),
        res,
        match.params,
      );

      expect(res._status).toBe(200);
      const body = parsed(res) as { updated: boolean; key: string; filePath: string };
      expect(body.updated).toBe(true);
      expect(body.key).toBe("new_name");
      expect(body.filePath).toContain("new_name");
      // Should write new file
      expect(saveYaml).toHaveBeenCalledWith(
        expect.stringContaining("new_name.yaml"),
        expect.objectContaining({ dict: { type: "string", values: ["a", "b"] } }),
      );
      // Should delete old file
      expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining("old_name.yaml"));
    });

    it("returns 409 when rename target key already exists", async () => {
      const dictMap = new Map([
        ["old_name", ["a"]],
        ["new_name", ["b"]],
      ]);
      const dictMeta = new Map([
        ["old_name", { type: "string" as const, values: ["a"] }],
        ["new_name", { type: "string" as const, values: ["b"] }],
      ]);
      vi.mocked(loadDictionaries).mockReturnValue({ dictionaries: dictMap, dictMeta, issues: [] });

      const match = router.match("PUT", "/api/dictionaries/old_name")!;
      const res = mockRes();
      await match.handler(
        mockReq("PUT", { key: "new_name", type: "string", values: ["a"] }),
        res,
        match.params,
      );

      expect(res._status).toBe(409);
      expect((parsed(res) as { error: string }).error).toContain("already exists");
    });

    it("rejects path traversal in rename target key", async () => {
      const dictMap = new Map([["old_name", ["a"]]]);
      const dictMeta = new Map([["old_name", { type: "string" as const, values: ["a"] }]]);
      vi.mocked(loadDictionaries).mockReturnValue({ dictionaries: dictMap, dictMeta, issues: [] });

      const match = router.match("PUT", "/api/dictionaries/old_name")!;
      const res = mockRes();
      await match.handler(
        mockReq("PUT", { key: "../etc/passwd", type: "string", values: ["a"] }),
        res,
        match.params,
      );

      expect(res._status).toBe(400);
    });

    it("does not rename when body key matches URL key", async () => {
      const fs = await import("node:fs");
      const dictMap = new Map([["same_key", ["a"]]]);
      const dictMeta = new Map([["same_key", { type: "string" as const, values: ["a"] }]]);
      vi.mocked(loadDictionaries).mockReturnValue({ dictionaries: dictMap, dictMeta, issues: [] });

      const match = router.match("PUT", "/api/dictionaries/same_key")!;
      const res = mockRes();
      await match.handler(
        mockReq("PUT", { key: "same_key", type: "string", values: ["a", "b"] }),
        res,
        match.params,
      );

      expect(res._status).toBe(200);
      expect((parsed(res) as { key: string }).key).toBe("same_key");
      // Should NOT delete old file (no rename)
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("updates dict references in event files during rename", async () => {
      const dictMap = new Map([["old_dict", ["a"]]]);
      const dictMeta = new Map([["old_dict", { type: "string" as const, values: ["a"] }]]);
      vi.mocked(loadDictionaries).mockReturnValue({ dictionaries: dictMap, dictMeta, issues: [] });
      vi.mocked(fileExists).mockReturnValue(false);
      // Mock scanDirectory to return some YAML files
      vi.mocked(scanDirectory).mockReturnValue(
        new Map([["auth/login.yaml", "/root/events/auth/login.yaml"]]),
      );
      vi.mocked(filterByExtension).mockReturnValue([
        ["auth/login.yaml", "/root/events/auth/login.yaml"],
      ]);

      // readFileSync is already mocked at module level; override for this test
      const fs = await import("node:fs");
      vi.mocked(fs.readFileSync as any).mockReturnValue("  type: string\n  dict: old_dict\n");

      const match = router.match("PUT", "/api/dictionaries/old_dict")!;
      const res = mockRes();
      await match.handler(
        mockReq("PUT", { key: "new_dict", type: "string", values: ["a"] }),
        res,
        match.params,
      );

      expect(res._status).toBe(200);
      // Should have read event files to update references
      expect(scanDirectory).toHaveBeenCalled();
    });
  });

  // DELETE /api/dictionaries/:key

  describe("DELETE /api/dictionaries/:key", () => {
    it("deletes an existing dictionary", async () => {
      const dictMap = new Map([["taxonomy/areas", ["auth"]]]);
      const dictMeta = new Map([["taxonomy/areas", { type: "string" as const, values: ["auth"] }]]);
      vi.mocked(loadDictionaries).mockReturnValue({ dictionaries: dictMap, dictMeta, issues: [] });

      const match = router.match("DELETE", "/api/dictionaries/taxonomy%2Fareas")!;
      const res = mockRes();
      await match.handler(mockReq("DELETE"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as { deleted: boolean; key: string };
      expect(body.deleted).toBe(true);
      expect(body.key).toBe("taxonomy/areas");
    });

    it("returns 404 for unknown key", async () => {
      const match = router.match("DELETE", "/api/dictionaries/unknown%2Fkey")!;
      const res = mockRes();
      await match.handler(mockReq("DELETE"), res, match.params);

      expect(res._status).toBe(404);
    });
  });

  // POST /api/validate

  describe("POST /api/validate", () => {
    it("returns grouped validation results", async () => {
      vi.mocked(validateEvents).mockResolvedValue([
        { event: "auth/login.yaml", path: "event.key", message: "Key too long", severity: "error" },
        {
          event: "auth/login.yaml",
          path: "payload.schema.x",
          message: "Unused field",
          severity: "warning",
        },
      ]);

      const match = router.match("POST", "/api/validate")!;
      const res = mockRes();
      await match.handler(mockReq("POST"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as {
        valid: boolean;
        errorCount: number;
        warningCount: number;
        events: Record<string, { errors: unknown[]; warnings: unknown[] }>;
      };
      expect(body.valid).toBe(false);
      expect(body.errorCount).toBe(1);
      expect(body.warningCount).toBe(1);
      expect(body.events["auth/login.yaml"].errors).toHaveLength(1);
      expect(body.events["auth/login.yaml"].warnings).toHaveLength(1);
    });

    it("returns valid: true when no errors", async () => {
      const match = router.match("POST", "/api/validate")!;
      const res = mockRes();
      await match.handler(mockReq("POST"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as { valid: boolean; errorCount: number };
      expect(body.valid).toBe(true);
      expect(body.errorCount).toBe(0);
    });

    it("validates single event when key provided", async () => {
      const match = router.match("POST", "/api/validate")!;
      const res = mockRes();
      await match.handler(mockReq("POST", { key: "auth::login" }), res, match.params);

      expect(res._status).toBe(200);
      expect(validateEvents).toHaveBeenCalledWith(
        [expect.objectContaining({ key: "auth::login" })],
        expect.anything(),
        expect.anything(),
      );
    });

    it("returns 404 when filtering by unknown key", async () => {
      const match = router.match("POST", "/api/validate")!;
      const res = mockRes();
      await match.handler(mockReq("POST", { key: "unknown::event" }), res, match.params);

      expect(res._status).toBe(404);
    });
  });
});

// ── taxonomyToFilePath unit tests ─────────────────────────

describe("taxonomyToFilePath", () => {
  it("converts taxonomy to file path using template", () => {
    const result = taxonomyToFilePath(
      { area: "auth", action: "login" },
      "{area}/{action}.yaml",
      "/root/events",
    );
    expect(result).toBe("/root/events/auth/login.yaml");
  });

  it("throws when required taxonomy field is missing", () => {
    expect(() =>
      taxonomyToFilePath({ area: "auth" }, "{area}/{action}.yaml", "/root/events"),
    ).toThrow("Missing taxonomy field 'action'");
  });
});
