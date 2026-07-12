import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.url("DATABASE_URL must be a valid Postgres URL"),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
