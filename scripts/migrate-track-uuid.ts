// One-shot migration: converts `track.id` from an identity integer to a uuid,
// carrying every existing track and its artist/playlist links across.
//
//   bun run scripts/migrate-track-uuid.ts [--dry-run]
//
// Safe to run repeatedly: a `track.id` that is already a uuid exits as a no-op.
// Everything below runs in one transaction, so a failure leaves the integer
// schema exactly as it was.
//
// The new ids are assigned by the database (`gen_random_uuid()` per row), so
// they are unrelated to the old integers — nothing outside the database may
// still hold a track id when this runs.
//
// Rather than a volatile column default (which would rewrite the heap, and with
// it the ~400 MB of TOASTed audio), the column is added nullable and filled by
// an UPDATE: that leaves each row's TOAST pointer alone and only rewrites the
// handful of heap tuples.
//
// Constraints are discovered from the catalog rather than named literally, so
// every foreign key pointing at `track.id` is carried across whether or not the
// drizzle schema declares it.
import { db } from "../src/db";

const sql = db.$client;
const dryRun = process.argv.includes("--dry-run");

/** A constraint captured before the swap, to be replayed verbatim after it. */
interface Captured {
  table: string;
  name: string;
  /** 'p' primary key, 'u' unique, 'f' foreign key. */
  type: string;
  /** `pg_get_constraintdef` output — still valid, column names don't change. */
  def: string;
}

/** A column referencing `track.id`, and whether it is NOT NULL today. */
interface RefColumn {
  table: string;
  column: string;
  notNull: boolean;
}

/** Row count of `table`, counting only rows whose `column` is set. */
async function countRows(table: string, column?: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    select count(*)::int as count from ${sql(table)}
    ${column === undefined ? sql`` : sql`where ${sql(column)} is not null`}
  `;
  return rows[0]?.count ?? 0;
}

async function trackIdType(): Promise<string> {
  const [row] = await sql<{ type: string }[]>`
    select format_type(a.atttypid, a.atttypmod) as type
    from pg_attribute a
    where a.attrelid = 'track'::regclass and a.attname = 'id' and a.attnum > 0
  `;
  if (!row) throw new Error("track.id not found");
  return row.type;
}

async function main(): Promise<void> {
  const idType = await trackIdType();
  if (idType === "uuid") {
    console.log("track.id is already uuid — nothing to do.");
    return;
  }
  if (idType !== "integer") {
    throw new Error(`unexpected track.id type: ${idType}`);
  }

  // --- Discover what points at track.id -----------------------------------

  const foreignKeys = await sql<
    { table: string; name: string; def: string; column: string }[]
  >`
    select c.conrelid::regclass::text as table,
           c.conname                  as name,
           pg_get_constraintdef(c.oid) as def,
           a.attname                  as column
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.confrelid = 'track'::regclass and c.contype = 'f'
  `;
  // A composite foreign key into track.id would need its other columns carried
  // too; none exists, and guessing at one would be worse than stopping.
  const composite = await sql<{ name: string }[]>`
    select conname as name from pg_constraint
    where confrelid = 'track'::regclass and contype = 'f'
      and array_length(conkey, 1) > 1
  `;
  if (composite.length > 0) {
    throw new Error(
      `composite foreign keys into track are not handled: ${composite
        .map((c) => c.name)
        .join(", ")}`,
    );
  }

  const refColumns: RefColumn[] = [];
  for (const fk of foreignKeys) {
    const [col] = await sql<{ notnull: boolean }[]>`
      select a.attnotnull as notnull
      from pg_attribute a
      where a.attrelid = ${fk.table}::regclass and a.attname = ${fk.column}
    `;
    refColumns.push({
      table: fk.table,
      column: fk.column,
      notNull: col?.notnull ?? false,
    });
  }

  // Primary keys and uniques whose key includes one of those columns: they are
  // built on the column's type, so they have to come down and go back up.
  const keyConstraints: Captured[] = [];
  for (const ref of refColumns) {
    const rows = await sql<
      { name: string; type: string; def: string; cols: string[] }[]
    >`
      select c.conname as name, c.contype as type,
             pg_get_constraintdef(c.oid) as def,
             (select array_agg(a.attname)
                from unnest(c.conkey) as k(attnum)
                join pg_attribute a
                  on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
      from pg_constraint c
      where c.conrelid = ${ref.table}::regclass and c.contype in ('p', 'u')
    `;
    for (const row of rows) {
      if (!row.cols.includes(ref.column)) continue;
      if (keyConstraints.some((k) => k.name === row.name)) continue;
      keyConstraints.push({
        table: ref.table,
        name: row.name,
        type: row.type,
        def: row.def,
      });
    }
  }

  const [trackPk] = await sql<{ name: string; def: string }[]>`
    select conname as name, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'track'::regclass and contype = 'p'
  `;
  if (!trackPk) throw new Error("track has no primary key");

  // Indexes on an affected column that no constraint owns would be dropped
  // silently along with the column, so stop instead of losing one.
  const strayIndexes: string[] = [];
  for (const target of [
    { table: "track", column: "id" },
    ...refColumns.map(({ table, column }) => ({ table, column })),
  ]) {
    const rows = await sql<{ index: string }[]>`
      select i.indexrelid::regclass::text as index
      from pg_index i
      join pg_attribute a
        on a.attrelid = i.indrelid and a.attnum = any(i.indkey::int[])
      where i.indrelid = ${target.table}::regclass
        and a.attname = ${target.column}
        and not exists (
          select 1 from pg_constraint c where c.conindid = i.indexrelid
        )
    `;
    for (const row of rows) {
      strayIndexes.push(`${row.index} on ${target.table}.${target.column}`);
    }
  }
  if (strayIndexes.length > 0) {
    throw new Error(
      `indexes on affected columns are not owned by a constraint: ${strayIndexes.join(
        ", ",
      )}`,
    );
  }

  // --- Report --------------------------------------------------------------

  const trackCount = await countRows("track");
  console.log(`tracks:            ${trackCount}`);
  console.log(`track primary key: ${trackPk.name} (${trackPk.def})`);
  console.log("referencing columns:");
  for (const ref of refColumns) {
    const count = await countRows(ref.table, ref.column);
    console.log(
      `  ${ref.table}.${ref.column}`.padEnd(34) +
        `${count} row(s)${ref.notNull ? ", not null" : ", nullable"}`,
    );
  }
  console.log("constraints to rebuild:");
  for (const c of [...keyConstraints, ...foreignKeys.map(toCaptured)]) {
    console.log(`  ${c.table}.${c.name}\n      ${c.def}`);
  }

  if (dryRun) {
    console.log("\ndry run — nothing was changed.");
    return;
  }

  // --- Swap ----------------------------------------------------------------

  await sql.begin(async (tx) => {
    // 1. A uuid per track, alongside the integer id it replaces.
    await tx`alter table track add column new_id uuid`;
    await tx`update track set new_id = gen_random_uuid()`;
    await tx`alter table track alter column new_id set not null`;

    // 2. Carry the mapping into every referencing column.
    for (const ref of refColumns) {
      await tx`alter table ${tx(ref.table)} add column new_track_id uuid`;
      await tx`
        update ${tx(ref.table)} as c
        set new_track_id = t.new_id
        from track t
        where c.${tx(ref.column)} = t.id
      `;
    }

    // 3. Take the old constraints down: foreign keys first (they depend on the
    //    primary key), then the keys built over the referencing columns, then
    //    track's own primary key.
    for (const fk of foreignKeys) {
      await tx`alter table ${tx(fk.table)} drop constraint ${tx(fk.name)}`;
    }
    for (const key of keyConstraints) {
      await tx`alter table ${tx(key.table)} drop constraint ${tx(key.name)}`;
    }
    await tx`alter table track drop constraint ${tx(trackPk.name)}`;

    // 4. Replace each integer column with its uuid twin, under the same name.
    await tx`alter table track drop column id`;
    await tx`alter table track rename column new_id to id`;
    await tx`alter table track alter column id set default gen_random_uuid()`;
    for (const ref of refColumns) {
      await tx`alter table ${tx(ref.table)} drop column ${tx(ref.column)}`;
      await tx`
        alter table ${tx(ref.table)} rename column new_track_id to ${tx(ref.column)}
      `;
      if (ref.notNull) {
        await tx`
          alter table ${tx(ref.table)} alter column ${tx(ref.column)} set not null
        `;
      }
    }

    // 5. Put the constraints back, in the order their dependencies need.
    await tx.unsafe(
      `alter table track add constraint "${trackPk.name}" ${trackPk.def}`,
    );
    for (const key of keyConstraints) {
      await tx.unsafe(
        `alter table ${key.table} add constraint "${key.name}" ${key.def}`,
      );
    }
    for (const fk of foreignKeys) {
      await tx.unsafe(
        `alter table ${fk.table} add constraint "${fk.name}" ${fk.def}`,
      );
    }
  });

  // --- Verify --------------------------------------------------------------

  const type = await trackIdType();
  const after = await countRows("track");
  const distinctRows = await sql<{ count: number }[]>`
    select count(distinct id)::int as count from track
  `;
  const distinct = distinctRows[0]?.count ?? 0;
  console.log("");
  console.log(`track.id type:     ${type}`);
  console.log(`tracks:            ${after} (was ${trackCount})`);
  console.log(`distinct ids:      ${distinct}`);
  for (const ref of refColumns) {
    const count = await countRows(ref.table, ref.column);
    console.log(`  ${ref.table}.${ref.column}`.padEnd(34) + `${count} row(s)`);
  }
  if (after !== trackCount || distinct !== after || type !== "uuid") {
    throw new Error("post-migration check failed");
  }
  console.log("\nmigration complete.");
}

function toCaptured(fk: {
  table: string;
  name: string;
  def: string;
}): Captured {
  return { table: fk.table, name: fk.name, type: "f", def: fk.def };
}

try {
  await main();
} finally {
  await sql.end();
}
