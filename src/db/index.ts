import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import { relations } from "./relations";

const client = postgres(env.DATABASE_URL);

export const db = drizzle({ client, relations });

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
