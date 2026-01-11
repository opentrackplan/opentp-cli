import { build } from "esbuild";

await build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.cjs",
    platform: "node",
    target: "node18",
    format: "cjs",
    bundle: true,
    banner: {
        js: "#!/usr/bin/env node",
    },
});