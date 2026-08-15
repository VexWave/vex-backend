# Bun, not Node: `src/auth.ts` uses `Bun.password`, `cli/ui.ts` `Bun.stringWidth`.
FROM oven/bun:1.3-slim

WORKDIR /app

# Before the sources, so the install layer caches. Dev deps included:
# `db:push` needs drizzle-kit.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Whole repo: the server imports `contract/`, and `cli/` creates the accounts.
# No build step — `tsconfig.json` is `noEmit`.
COPY . .

USER bun

EXPOSE 3700

# Exec form, so SIGTERM reaches the shutdown handler in `src/app/server.ts`.
CMD ["bun", "src/index.ts"]
