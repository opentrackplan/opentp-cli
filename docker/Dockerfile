# Stage 1: Build UI
FROM oven/bun:1 AS ui-build
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN bun install --frozen-lockfile
COPY ui/ .
RUN bun run build

# Stage 2: Build CLI
FROM oven/bun:1 AS cli-build
WORKDIR /app/cli
COPY package.json ./
RUN bun install
COPY src/ ./src/
COPY esbuild/ ./esbuild/
COPY tsconfig.json ./
RUN bun run build

# Stage 3: Runtime
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=cli-build /app/cli/dist/ ./dist/
COPY --from=ui-build /app/ui/dist/ ./ui-dist/
ENV OPENTP_UI_DIR=/app/ui-dist
EXPOSE 3000
ENTRYPOINT ["bun", "run", "./dist/index.cjs"]
CMD ["serve", "--host", "0.0.0.0", "--root", "/data"]
