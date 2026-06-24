import { exec } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { registerApiRoutes } from "./api";
import { registerGenerateRoutes } from "./generate";
import { Router } from "./router";
import { serveStatic } from "./static";
import { startWatcher } from "./watcher";
import { WebSocketServer } from "./ws";

export interface ServeOptions {
  port: number;
  host: string;
  root: string;
  open: boolean;
  noUi: boolean;
}

export async function startServer(options: ServeOptions): Promise<void> {
  const router = new Router();

  // Health check
  router.get("/api/health", (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });

  // Register API routes
  registerApiRoutes(router, options.root);
  registerGenerateRoutes(router, options.root);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS headers (for local dev)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Try API routes first
    if (pathname.startsWith("/api/")) {
      const match = router.match(req.method ?? "GET", pathname);
      if (match) {
        try {
          await match.handler(req, res, match.params);
        } catch (err) {
          console.error(`Error handling ${pathname}:`, err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // Serve static UI files (if not --no-ui)
    if (!options.noUi) {
      await serveStatic(req, res, pathname);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  // WebSocket for live reload
  const wsServer = new WebSocketServer();
  wsServer.attach(server);

  // File watcher
  const watcher = startWatcher({
    root: options.root,
    onChange(event) {
      console.log(`  File ${event.type}: ${event.path}`);
      wsServer.broadcast(
        JSON.stringify({
          type: "file-change",
          path: event.path,
          changeType: event.type,
        }),
      );
    },
  });

  // Clean shutdown
  const shutdown = () => {
    console.log("\n  Shutting down...");
    watcher.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>((_resolve, reject) => {
    server.on("error", reject);
    server.listen(options.port, options.host, () => {
      const url = `http://${options.host}:${options.port}`;
      console.log(`\n  OpenTrackPlan server running at ${url}`);
      console.log(`  Tracking plan: ${options.root}`);
      console.log(`  API: ${url}/api/health`);
      console.log(`  Live reload: ws://${options.host}:${options.port}/ws\n`);

      if (options.open) {
        const cmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        exec(`${cmd} ${url}`);
      }
    });
    // Never resolve — server runs until SIGINT/SIGTERM
  });
}
