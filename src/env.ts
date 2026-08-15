import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.url("DATABASE_URL must be a valid Postgres URL"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3700),
  TRUST_PROXY: z.stringbool().default(false),
  IMAGE_CACHE_BYTES: z.coerce
    .number()
    .int()
    .min(0)
    .default(128 * 1024 * 1024),
  DISCORD_WEBHOOK_URL: z
    .union([z.url(), z.literal("")])
    .optional()
    .transform((value) => value || undefined),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
