# VexWave Server

The server half of [VexWave](https://github.com/VexWave/vex-app).

Bun + Fastify + ts-rest + Postgres.

## Setup

Needs **[Bun](https://bun.sh) 1.3+** and **PostgreSQL 13+**.

```sh
bun install
cp .env.example .env      # configuration
bun run start
```

There is no signup route. Create accounts with the admin CLI:

```sh
bun run cli
```

## Docker

```sh
curl -o docker-compose.yml https://raw.githubusercontent.com/VexWave/vex-backend/main/docker-compose.prod.yml
$EDITOR docker-compose.yml                 # configuration
docker compose up -d
docker compose exec app bun run cli        # create the first account
```

| Command                                       | What it does                    |
| --------------------------------------------- | ------------------------------- |
| `docker compose logs -f app`                  | Follow the request log          |
| `docker compose exec app bun run cli`         | Admin CLI on the running server |
| `docker compose pull && docker compose up -d` | Update to the latest image      |

## Configuration

| Variable              | Default     | What it does                                                                                                                                    |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | _required_  | Postgres connection string.                                                                                                                     |
| `PORT`                | `3700`      | Port to listen on.                                                                                                                              |
| `TRUST_PROXY`         | `false`     | Take the caller's address from `X-Forwarded-For`. Only behind a proxy you control; otherwise anyone can forge it and walk past the rate limits. |
| `IMAGE_CACHE_BYTES`   | `134217728` | Memory budget for the served-image cache. `0` serves every image from the database.                                                             |
| `DISCORD_WEBHOOK_URL` | _(off)_     | Webhook that notable events are mirrored to. Treat it as a secret.                                                                              |

## Scripts

| Command             | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `bun run dev`       | Run with `--watch`                                             |
| `bun run start`     | Run once                                                       |
| `bun run cli`       | Admin CLI for users and sessions                               |
| `bun run release`   | Tag a version, which publishes the image                       |
| `bun run db:push`   | Apply `src/db/schema.ts` by hand; the server does this at boot |
| `bun run db:studio` | Drizzle Studio                                                 |
| `bun run fmt`       | Prettier over the repo                                         |
