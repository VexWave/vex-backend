import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import { relations } from "./relations";

const client = postgres(env.DATABASE_URL);

// drizzle-orm v1: pass the client and the `relations` object (the v1
// replacement for the old `schema` config) so `db.query.*` works.
export const db = drizzle({ client, relations });
