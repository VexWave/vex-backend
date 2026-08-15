import { pushSchema } from "drizzle-kit/api-postgres";
import { sql, type SQL } from "drizzle-orm";
import { db } from ".";
import * as schema from "./schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Arbitrary, but the same in every instance — an advisory lock is only a lock
// if everyone asks for the same number.
const LOCK_KEY = 0x76_45_78_30;

// drizzle-kit reads a result off `.rows`; postgres-js returns the row array
// itself, so it gets handed a wrapper rather than the transaction.
const asClient = (tx: Transaction) =>
  ({
    execute: async (query: SQL) => ({ rows: await tx.execute(query) }),
  }) as unknown as Parameters<typeof pushSchema>[1];

/**
 * Applies `schema.ts` to the database, and returns the statements that took —
 * none when the two already agree, which is the usual case.
 *
 * This is `db:push` in-process at every boot, so a fresh database needs no
 * setup step. One transaction does the lot: the advisory lock serialises
 * instances starting at the same moment, and a statement that fails takes the
 * rest of the push back out with it rather than leaving the schema half done.
 */
export async function syncSchema(): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);

    const { sqlStatements, apply } = await pushSchema(schema, asClient(tx));
    if (sqlStatements.length > 0) {
      await apply();
    }
    return sqlStatements;
  });
}
