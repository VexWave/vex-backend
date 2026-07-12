# AGENTS.md

Guidance for AI agents working in this repository.

## Database (Drizzle ORM — prerelease v1)

This project depends on a **prerelease v1 of drizzle-orm** (`drizzle-orm@1.0.0-rc.4`, `drizzle-kit@1.0.0-rc.4`, per `package.json`). The way drizzle is used **fundamentally changed** from the stable v0.x API, so do not rely on training-data recollection of drizzle — research/verify the current v1 API before writing DB code (check the installed `node_modules/drizzle-orm/*.d.ts` and v1 docs).

Concrete v1 differences already relied on here:

- Relations use `defineRelations(schema, (r) => ({...}))`, **not** the old per-table `relations()` helper. `db` is built with `drizzle({ client, relations })`.
- The relational query builder (`db.query.*`) uses object-filter syntax: `db.query.user.findFirst({ where: { username }, with: { tracks: true } })`.
- `one` relations default to `optional: true`; set `optional: false` for required (NOT NULL) FK sides.
- `bytea` is a built-in column type (`drizzle-orm/pg-core`), not a custom type.

Migrations currently use `bun run db:push` (drizzle-kit push); no migration files exist yet.

## Use `db.query` for reads

For **getting/reading data, use `db.query.<table>.findFirst/findMany`**, not `db.select().from()`.

**Why:** The prerelease v1 relational query builder is terser, returns nested related data via `with`, and returns a single row (or `undefined`) from `findFirst` without manual `[0]` unwrapping.

**How to apply:**

- Reads: `db.query.user.findFirst({ columns: {...}, where: { username }, with: { tracks: true } })`.
- `where` uses object-filter syntax on the table's own columns (`{ username }`, `{ token }`) — no `eq()` import needed.
- Writes (insert/update/delete) still use the core API (`db.insert().values().returning()`); `db.query.*` is read-only.
- Any table in the schema is queryable via `db.query.*` once passed to `defineRelations(schema, ...)`, even without declared relations — but to traverse with `with`, the relation must exist (see below).

## Don't wrap DB calls in `tryCatch`

**Do not wrap database calls (`db.query.*`, `db.insert()`, etc.) in the `tryCatch` helper.** Call them directly and use the return value.

## Declare every relationship in `src/db/relations.ts`

**When creating a new database relationship, always add it to `src/db/relations.ts`.** Declare a relation for _every_ relationship that exists in the schema, so it can be traversed from `db.query.*` using `with`.

**Why:** A foreign key in `schema.ts` alone does NOT make the relation navigable in the relational query builder — the relation must be declared in `relations.ts` (via `defineRelations`) for `with: { <relation>: true }` to work.
