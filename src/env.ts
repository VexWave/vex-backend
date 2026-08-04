import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.url("DATABASE_URL must be a valid Postgres URL"),

  // Interface to bind. Defaults to every interface; set it to 127.0.0.1 when
  // a reverse proxy in front of the API is the only thing that should be able
  // to reach it.
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3700),

  // Whether to believe `X-Forwarded-For`. Leave it off unless a proxy you
  // control sets that header: with it on, any client can forge its source
  // address and walk straight through the per-IP rate limits.
  TRUST_PROXY: z.stringbool().default(false),

  // How much memory the served-image cache may hold, in bytes. It is a hard
  // ceiling on that cache's own footprint, not on the process, so leave room
  // for everything else — an upload alone can hold ~100 MiB while it is being
  // decoded. Set it to 0 to serve every image from the database.
  IMAGE_CACHE_BYTES: z.coerce
    .number()
    .int()
    .min(0)
    .default(128 * 1024 * 1024),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
