---
name: verify
description: How to run and drive this backend to verify changes end-to-end.
---

# Verifying vex-backend

Bun + Fastify + ts-rest backend, Postgres via `DATABASE_URL` in `.env`
(a remote test database — safe to create and delete rows).

## Launch

```
bun src/index.ts        # foreground; run in background for driving
```

Listens on `http://localhost:3700` ("Listening on port 3700"). No watch
mode unless you use `bun run dev` — restart after code changes.

## Auth

There is no register endpoint. Seed a user directly with a Bun script that
imports `src/db`, `src/db/schema`, and `hashPassword` from `src/auth`, then
`POST /login` with `{ username, password }` to get a session token. Pass the
token as the raw `authorization` header (no `Bearer` prefix). Delete the
user's `session` rows before deleting the user when cleaning up.

## Driving

Use plain `fetch` against `http://localhost:3700` (the ts-rest fetch client
buffers bodies, which hides streaming behavior). Typical flow:
`/login` → `/postArtist` → `/postTrack` (body `compressed_data` is
**gzipped** audio bytes, base64-encoded; `Bun.gzipSync` works) →
`/editTrack` to link artists → `/tracks` → `/track/:id/audio`
(test `Range` headers: normal, open-ended, suffix `bytes=-N`,
unsatisfiable past-EOF, malformed). Clean up with `/deleteTrack` and
`/deleteArtist`.

## Gotchas

- Scratchpad scripts live on `C:` while the repo is on `F:` — use absolute
  imports like `import { db } from "F:/Dokumente/vex-backend/src/db"`.
- `/track/:id/audio` serves the **decompressed** bytes; byte ranges address
  the raw audio, and responses set `accept-ranges: bytes`.
