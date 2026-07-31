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
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
