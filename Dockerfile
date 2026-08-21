FROM oven/bun:1.4-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

USER bun

EXPOSE 3700

CMD ["bun", "src/index.ts"]
