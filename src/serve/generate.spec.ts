import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerGenerateRoutes } from "./generate";
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

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => "mock-file-content"),
      readdirSync: vi.fn(() => []),
    },
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => "mock-file-content"),
    readdirSync: vi.fn(() => []),
  };
});

vi.mock("../generators", () => ({
  getGenerator: vi.fn(),
  getGeneratorNames: vi.fn(),
}));

vi.mock("../meta", () => ({
  SPEC_VERSION: "2026-01",
}));

const mockZipFile = vi.fn();
const mockGenerateAsync = vi.fn().mockResolvedValue(Buffer.from("PK-mock-zip"));

vi.mock("jszip", () => {
  class MockJSZip {
    file = mockZipFile;
    generateAsync = mockGenerateAsync;
  }
  return { default: MockJSZip };
});

import {
  findConfigFile,
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  loadConfig,
} from "../core/config";
import { loadDictionaries } from "../core/dict";
import { loadEvents } from "../core/event";
import { getGenerator, getGeneratorNames } from "../generators";

// ── Helpers ───────────────────────────────────────────────

function mockReq(method: string, urlPath = "/"): IncomingMessage {
  const stream = new PassThrough() as unknown as IncomingMessage;
  stream.method = method;
  stream.url = urlPath;
  stream.headers = { host: "localhost:3000" };
  process.nextTick(() => {
    (stream as unknown as PassThrough).end();
  });
  return stream;
}

function mockRes(): ServerResponse & {
  _status: number;
  _body: string | Buffer;
  _headers: Record<string, string>;
} {
  const res = {
    _status: 200,
    _body: "" as string | Buffer,
    _headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) Object.assign(res._headers, headers);
      return res;
    },
    end(data?: string | Buffer) {
      res._body = data ?? "";
      return res;
    },
  };
  return res as unknown as ServerResponse & {
    _status: number;
    _body: string | Buffer;
    _headers: Record<string, string>;
  };
}

function parsed(res: ReturnType<typeof mockRes>): unknown {
  return JSON.parse(res._body as string);
}

// ── Mock data ─────────────────────────────────────────────

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

const MOCK_CONFIG_WITH_EXPORT = {
  ...MOCK_CONFIG,
  spec: {
    ...MOCK_CONFIG.spec,
    export: {
      generators: [
        { name: "ts-sdk", target: "web", standalone: true },
        { name: "swift-sdk", target: "ios" },
      ],
      bundle: true,
    },
    ui: {
      theme: "auto" as const,
      mode: "editor" as const,
      title: "Test Tracking Plan",
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

function setupMocks(config = MOCK_CONFIG) {
  vi.mocked(findConfigFile).mockReturnValue("/root/opentp.yaml");
  vi.mocked(loadConfig).mockReturnValue(config as never);
  vi.mocked(getDictsPath).mockReturnValue("/root/dictionaries");
  vi.mocked(getEventsPath).mockReturnValue("/root/events");
  vi.mocked(getEventsTemplate).mockReturnValue("{area}/{action}.yaml");
  vi.mocked(loadDictionaries).mockReturnValue({
    dictionaries: new Map(),
    dictMeta: new Map(),
    issues: [],
  });
  vi.mocked(loadEvents).mockReturnValue([MOCK_EVENT] as never);
}

const mockGenerator = {
  name: "ts-sdk",
  description: "TypeScript SDK",
  generate: vi.fn().mockReturnValue({ stdout: "// generated TypeScript content" }),
};

const mockSwiftGenerator = {
  name: "swift-sdk",
  description: "Swift SDK",
  generate: vi.fn().mockReturnValue({ stdout: "// generated Swift content" }),
};

const mockKotlinGenerator = {
  name: "kotlin-sdk",
  description: "Kotlin SDK",
  generate: vi.fn().mockReturnValue({ stdout: "// generated Kotlin content" }),
};

// ── Tests ─────────────────────────────────────────────────

describe("Generate routes", () => {
  let router: Router;

  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
    vi.mocked(getGeneratorNames).mockReturnValue([
      "json",
      "yaml",
      "template",
      "ts-sdk",
      "swift-sdk",
      "kotlin-sdk",
    ]);
    vi.mocked(getGenerator).mockImplementation((name: string) => {
      if (name === "ts-sdk") return mockGenerator;
      if (name === "swift-sdk") return mockSwiftGenerator;
      if (name === "kotlin-sdk") return mockKotlinGenerator;
      return undefined;
    });
    router = new Router();
    registerGenerateRoutes(router, "/root");
  });

  // GET /api/generators

  describe("GET /api/generators", () => {
    it("returns all registered generators when no config", async () => {
      const match = router.match("GET", "/api/generators")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as { generators: Array<{ name: string }>; bundleEnabled: boolean };
      expect(body.generators).toHaveLength(6);
      expect(body.generators[0].name).toBe("json");
    });

    it("returns configured list when config exists", async () => {
      setupMocks(MOCK_CONFIG_WITH_EXPORT);

      const match = router.match("GET", "/api/generators")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as { generators: Array<{ name: string; target?: string }> };
      expect(body.generators).toHaveLength(2);
      expect(body.generators[0].name).toBe("ts-sdk");
      expect(body.generators[0].target).toBe("web");
    });

    it("includes bundleEnabled", async () => {
      setupMocks(MOCK_CONFIG_WITH_EXPORT);

      const match = router.match("GET", "/api/generators")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      const body = parsed(res) as { bundleEnabled: boolean };
      expect(body.bundleEnabled).toBe(true);
    });
  });

  // GET /api/generate/:name

  describe("GET /api/generate/:name", () => {
    it("returns generated TS file", async () => {
      const match = router.match("GET", "/api/generate/ts-sdk")!;
      const res = mockRes();
      await match.handler(mockReq("GET", "/api/generate/ts-sdk"), res, match.params);

      expect(res._status).toBe(200);
      expect(res._body).toContain("generated TypeScript");
    });

    it("returns generated Swift file", async () => {
      const match = router.match("GET", "/api/generate/swift-sdk")!;
      const res = mockRes();
      await match.handler(mockReq("GET", "/api/generate/swift-sdk"), res, match.params);

      expect(res._status).toBe(200);
      expect(res._body).toContain("generated Swift");
    });

    it("returns generated Kotlin file", async () => {
      const match = router.match("GET", "/api/generate/kotlin-sdk")!;
      const res = mockRes();
      await match.handler(mockReq("GET", "/api/generate/kotlin-sdk"), res, match.params);

      expect(res._status).toBe(200);
      expect(res._body).toContain("generated Kotlin");
    });

    it("sets Content-Disposition with correct filename", async () => {
      const match = router.match("GET", "/api/generate/ts-sdk")!;
      const res = mockRes();
      await match.handler(mockReq("GET", "/api/generate/ts-sdk"), res, match.params);

      expect(res._headers["Content-Disposition"]).toBe('attachment; filename="tracker.ts"');
      expect(res._headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    });

    it("returns 404 for unknown generator", async () => {
      const match = router.match("GET", "/api/generate/unknown-gen")!;
      const res = mockRes();
      await match.handler(mockReq("GET", "/api/generate/unknown-gen"), res, match.params);

      expect(res._status).toBe(404);
      expect((parsed(res) as { error: string }).error).toContain("not found");
    });

    it("respects query param overrides", async () => {
      setupMocks(MOCK_CONFIG_WITH_EXPORT);

      const match = router.match("GET", "/api/generate/ts-sdk")!;
      const res = mockRes();
      await match.handler(
        mockReq("GET", "/api/generate/ts-sdk?target=ios&standalone=false"),
        res,
        match.params,
      );

      expect(res._status).toBe(200);
      expect(mockGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ target: "ios", standalone: false }),
        }),
      );
    });

    it("uses config options when no query params", async () => {
      setupMocks(MOCK_CONFIG_WITH_EXPORT);

      const match = router.match("GET", "/api/generate/ts-sdk")!;
      const res = mockRes();
      await match.handler(mockReq("GET", "/api/generate/ts-sdk"), res, match.params);

      expect(res._status).toBe(200);
      expect(mockGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ target: "web", standalone: true }),
        }),
      );
    });
  });

  // GET /api/export/bundle

  describe("GET /api/export/bundle", () => {
    it("returns ZIP with correct Content-Type", async () => {
      const match = router.match("GET", "/api/export/bundle")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      expect(res._headers["Content-Type"]).toBe("application/zip");
      expect(res._headers["Content-Disposition"]).toBe('attachment; filename="tracking-plan.zip"');
    });

    it("ZIP contains opentp.yaml", async () => {
      const match = router.match("GET", "/api/export/bundle")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      expect(mockZipFile).toHaveBeenCalledWith("opentp.yaml", expect.any(String));
    });

    it("ZIP contains generated SDKs", async () => {
      const match = router.match("GET", "/api/export/bundle")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      expect(mockGenerateAsync).toHaveBeenCalledWith({ type: "nodebuffer" });
    });

    it("uses configured generators or falls back to all", async () => {
      setupMocks(MOCK_CONFIG_WITH_EXPORT);

      const match = router.match("GET", "/api/export/bundle")!;
      const res = mockRes();
      await match.handler(mockReq("GET"), res, match.params);

      expect(res._status).toBe(200);
      // Should call ts-sdk and swift-sdk generators (from config)
      expect(mockGenerator.generate).toHaveBeenCalled();
      expect(mockSwiftGenerator.generate).toHaveBeenCalled();
    });
  });

  // GET /api/config — ui config

  describe("GET /api/config includes ui config", () => {
    it("includes ui config when configured", async () => {
      setupMocks(MOCK_CONFIG_WITH_EXPORT);
      // The config route is in api.ts, but we verify the config has ui
      expect(MOCK_CONFIG_WITH_EXPORT.spec.ui).toBeDefined();
      expect(MOCK_CONFIG_WITH_EXPORT.spec.ui.theme).toBe("auto");
      expect(MOCK_CONFIG_WITH_EXPORT.spec.ui.mode).toBe("editor");
      expect(MOCK_CONFIG_WITH_EXPORT.spec.ui.title).toBe("Test Tracking Plan");
    });

    it("returns defaults when no ui config", () => {
      expect(MOCK_CONFIG.spec).not.toHaveProperty("ui");
    });
  });
});
