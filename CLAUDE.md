# CLAUDE.md

Guidance for AI agents working in this repository. Rules and constraints only —
anything discoverable by reading the code is left to the code.

## Drizzle ORM is a prerelease v1

`drizzle-orm@1.0.0-rc.4` / `drizzle-kit@1.0.0-rc.4`. The API changed
fundamentally from v0.x, so do not write DB code from recollection — check
`node_modules/drizzle-orm/*.d.ts` or the v1 docs first. `extras` in particular
is an object of `key -> (table, { sql }) => SQLWrapper`, not the single-callback
form the older docs show.

`drizzle-kit` is imported at runtime (`src/db/sync.ts`) despite sitting in
`devDependencies`; a build that prunes those breaks at boot.

## Schema changes need no migration step

`src/index.ts` pushes `src/db/schema.ts` to the database before the server
loads. There are no migration files; `bun run db:push` is the same push by hand.

## Reads

- Use `db.query.<table>.findFirst/findMany`, not `db.select().from()`. Writes
  still use the core API; `db.query.*` is read-only.
- Never select an image or audio column just to test whether it is present.
  Each image column has a generated `*_hash` beside it that is null exactly when
  the column is; otherwise use `extras` with `octet_length` or a predicate.
- **`UserManager.listData` is one statement on purpose.** Postgres evaluates it
  against a single snapshot, which is what makes `/data`'s `artistIds` and
  `trackIds` resolve against the rows sent beside them. Splitting it into
  per-table reads needs a transaction to promise the same thing and measured
  ~3x slower; add new fields to its `with`, not as a second query.
- Do not wrap DB calls in `tryCatch` (`src/utils.ts`). Call them directly.

## Contract, endpoints, and data access

- **`contract/contract.ts` is the single source of truth** for routes and
  validation. Request schemas are named `*Request`, responses `*Response`; put
  new ones in the matching labeled section.
- **One bulk read route.** `getData` returns the whole library, with tracks
  referencing artists by id. Do not add per-resource listing routes — extend
  `DataResponse`.
- **Endpoints are one per file** in `src/app/endpoints/<name>.ts`, and must be
  registered in the `s.router({...})` call in `src/app/server.ts`.
- **Auth** is `UserManager.fromRequest(request)`; `null` means 401. The
  `requireAuth` hook has already rejected tokenless callers, so this costs no
  extra query — but keep the `null` check, since the type cannot know that.
- **Route policy lives in the contract**, as `metadata` typed by `RoutePolicy`;
  the hooks in `src/app/hooks.ts` keep no route lists of their own. Omitting
  `metadata` is safe: the defaults require a token, allow only a small body, and
  forbid caching.
- **User-scoped data access lives in `UserManager`**, every query filtered by
  `userId`. Writes carry the ownership filter in their own `WHERE` clause;
  `updateTrack` and `updatePlaylist` also pre-check ownership, because they must
  tell "not found" from "invalid ids" before starting multi-statement work.
- **Public / un-scoped reads do not belong in `UserManager`** — put the query in
  the endpoint file (see `getArtistImage.ts`).
