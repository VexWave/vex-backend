// One-shot migration: rewrites gzipped `track.data` blobs as the raw audio
// bytes the server now stores and serves.
//
//   bun run scripts/decompress-tracks.ts [--dry-run]
//
// Safe to run repeatedly: each row is classified by its own first two bytes,
// so rows that already hold raw audio are left untouched.
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { track } from "../src/db/schema";

const dryRun = process.argv.includes("--dry-run");

// gzip's magic number (RFC 1952); the SQL probe below tests for the same two
// bytes without pulling the blob over the wire.
function isGzipped(bytes: Buffer): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function main(): Promise<void> {
  // The blobs are multi-MB, so the pass over the table reads only each row's
  // id, its length and its first two bytes; the bytes themselves are fetched
  // one row at a time, and only for rows that turn out to be gzipped.
  const rows = await db.query.track.findMany({
    columns: { id: true, title: true },
    extras: {
      size: (t, { sql }) => sql<number>`octet_length(${t.data})`,
      gzipped: (t, { sql }) =>
        sql<boolean>`substring(${t.data} from 1 for 2) = '\\x1f8b'::bytea`,
    },
  });

  let skipped = 0;
  let decompressed = 0;
  const failed: number[] = [];
  let bytesBefore = 0;
  let bytesAfter = 0;

  console.log(
    `${rows.length} track row(s)${dryRun ? " — dry run, nothing is written" : ""}`,
  );

  for (const row of rows) {
    bytesBefore += row.size;

    if (!row.gzipped) {
      bytesAfter += row.size;
      skipped++;
      continue;
    }

    const stored = await db.query.track.findFirst({
      columns: { data: true },
      where: { id: row.id },
    });
    // The row can have been deleted between the pass above and now.
    if (stored === undefined) {
      bytesBefore -= row.size;
      continue;
    }

    // Re-checked against the bytes actually in hand, not the pass's snapshot.
    if (!isGzipped(stored.data)) {
      bytesAfter += stored.data.byteLength;
      skipped++;
      continue;
    }

    let raw: Buffer;
    try {
      raw = Buffer.from(Bun.gunzipSync(new Uint8Array(stored.data)));
    } catch (error) {
      // A blob that starts like gzip but won't inflate is left exactly as it
      // is: writing anything here would destroy the only copy of the track.
      bytesAfter += row.size;
      failed.push(row.id);
      console.error(
        `  #${row.id} "${row.title}" — gunzip failed, left untouched: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    bytesAfter += raw.byteLength;
    decompressed++;
    console.log(
      `  #${row.id} "${row.title}" — ${dryRun ? "would decompress" : "decompressed"} ${row.size}B -> ${raw.byteLength}B`,
    );

    if (!dryRun) {
      await db.transaction(async (tx) => {
        await tx.update(track).set({ data: raw }).where(eq(track.id, row.id));
      });
    }
  }

  console.log("");
  console.log(`total rows:    ${rows.length}`);
  console.log(`already raw:   ${skipped}`);
  console.log(`decompressed:  ${decompressed}${dryRun ? " (would be)" : ""}`);
  console.log(
    `failed:        ${failed.length}${failed.length > 0 ? ` (ids ${failed.join(", ")})` : ""}`,
  );
  console.log(`bytes before:  ${bytesBefore} (${mib(bytesBefore)})`);
  console.log(`bytes after:   ${bytesAfter} (${mib(bytesAfter)})`);
}

try {
  await main();
} finally {
  await db.$client.end();
}
