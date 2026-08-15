# Bun, not Node: `src/auth.ts` uses `Bun.password`, `cli/ui.ts` `Bun.stringWidth`.
FROM oven/bun:1.3-slim

# The slim image ships without curl; the compose healthcheck is a curl.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Before the sources, so the install layer caches. Dev deps included:
# drizzle-kit is what pushes the schema, which now happens at every boot
# (`src/db/sync.ts`), so it is a runtime dependency here.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Whole repo: the server imports `contract/`, and `cli/` creates the accounts.
# No build step — `tsconfig.json` is `noEmit`.
COPY . .

USER bun

EXPOSE 3700

# Exec form, so SIGTERM reaches the shutdown handler in `src/app/server.ts`.
CMD ["bun", "src/index.ts"]
