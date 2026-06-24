import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const isLib = process.env.BUILD_LIB === "1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: isLib
    ? {
        lib: {
          entry: {
            "opentp-ui": "src/web-component.tsx",
            "opentp-platform": "src/web-component-platform.tsx",
          },
          formats: ["es"],
        },
        outDir: "dist/lib",
      }
    : undefined,
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
