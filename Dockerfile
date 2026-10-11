FROM oven/bun:1.4.3-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

USER bun

EXPOSE 3700

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD ["bun", "src/healthcheck.ts"]

CMD ["bun", "src/index.ts"]
