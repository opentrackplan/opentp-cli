import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Path to bundled UI files — set via OPENTP_UI_DIR env var (used in Docker)
const UI_DIR: string | null = process.env.OPENTP_UI_DIR || null;

const PLACEHOLDER_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>OpenTrackPlan</title>
  <style>
    body { font-family: system-ui; background: #0a0a0f; color: #e2e2e8; display: flex;
           align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .container { text-align: center; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    p { color: #64748b; font-size: 14px; }
    code { background: #1e1e2e; padding: 2px 8px; border-radius: 4px; font-size: 13px; }
    a { color: #60a5fa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>OpenTrackPlan</h1>
    <p>Server is running. API available at <code>/api/health</code></p>
    <p>UI not yet bundled. Use <code>--no-ui</code> for API-only mode.</p>
  </div>
</body>
</html>`;

export async function serveStatic(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<void> {
  if (!UI_DIR) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(PLACEHOLDER_HTML);
    return;
  }

  const filePath = join(UI_DIR, pathname === "/" ? "index.html" : pathname);
  const ext = extname(filePath);
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeType });
    res.end(content);
  } catch {
    // SPA fallback — serve index.html for client-side routing
    try {
      const index = await readFile(join(UI_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(index);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
}
