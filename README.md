# VexWave Server

The server half of [VexWave](https://github.com/VexWave/vex-app). Tracks, cover
art and playlists live in Postgres, audio included, so there is no media
directory to mount or back up.

Bun + Fastify + ts-rest over Postgres (drizzle).

## Setup

Needs **[Bun](https://bun.sh) 1.3+** and **PostgreSQL 13+**.

```sh
bun install
cp .env.example .env      # then set DATABASE_URL
bun run db:push           # create the tables
bun run start
```

There is no signup route. Create accounts with the admin CLI:

```sh
bun run cli
```

## Configuration

`.env`, validated at boot (`src/env.ts`); a bad value stops the server starting.

| Variable              | Default     | What it does                                                                                                                                    |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | _required_  | Postgres connection string.                                                                                                                     |
| `HOST`                | `0.0.0.0`   | Interface to bind. `127.0.0.1` when a reverse proxy is the only thing that should reach the API.                                                |
| `PORT`                | `3700`      | Port to listen on.                                                                                                                              |
| `TRUST_PROXY`         | `false`     | Take the caller's address from `X-Forwarded-For`. Only behind a proxy you control; otherwise anyone can forge it and walk past the rate limits. |
| `IMAGE_CACHE_BYTES`   | `134217728` | Memory budget for the served-image cache. `0` serves every image from the database.                                                             |
| `DISCORD_WEBHOOK_URL` | _(off)_     | Webhook that notable events are mirrored to. Treat it as a secret.                                                                              |

## Scripts

| Command             | What it does                             |
| ------------------- | ---------------------------------------- |
| `bun run dev`       | Run with `--watch`                       |
| `bun run start`     | Run once                                 |
| `bun run cli`       | Admin CLI for users and sessions         |
| `bun run db:push`   | Apply `src/db/schema.ts` to the database |
| `bun run db:studio` | Drizzle Studio                           |
| `bun run fmt`       | Prettier over the repo                   |