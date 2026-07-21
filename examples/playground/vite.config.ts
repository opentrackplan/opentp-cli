import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 4000,
    fs: {
      allow: ["../../.."],
    },
    proxy: {
      // Web app API — CLI serve on port 3001
      "/web/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/web/, ""),
      },
      "/web/ws": {
        target: "ws://localhost:3001",
        ws: true,
        rewrite: (path) => path.replace(/^\/web/, ""),
      },
      // Mobile app API — CLI serve on port 3002
      "/mobile/api": {
        target: "http://localhost:3002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mobile/, ""),
      },
      "/mobile/ws": {
        target: "ws://localhost:3002",
        ws: true,
        rewrite: (path) => path.replace(/^\/mobile/, ""),
      },
    },
  },
});
