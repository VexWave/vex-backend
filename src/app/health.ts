import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { clean, messageOf } from "../logger";

const PING_TIMEOUT_MS = 2_000;

function isLoopback(address: string | undefined): boolean {
  if (address === undefined) {
    return false;
  }

  const plain = address.startsWith("::ffff:") ? address.slice(7) : address;
  return plain === "::1" || plain.startsWith("127.");
}

async function pingDatabase(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${PING_TIMEOUT_MS}ms`)),
          PING_TIMEOUT_MS,
        );
      }),
    ]);
    return null;
  } catch (err) {
    const message = messageOf(err) ?? "unknown error";
    const cause = err instanceof Error ? messageOf(err.cause) : undefined;
    return clean(cause === undefined ? message : `${message}: ${cause}`, 200);
  } finally {
    clearTimeout(timer);
  }
}

export function registerHealth(app: FastifyInstance): void {
  app.get(
    "/health",
    {
      onRequest: async (request, reply) => {
        if (!isLoopback(request.socket.remoteAddress)) {
          return reply.status(404).send("Not found");
        }
        request.quiet = true;
      },
    },
    async (_request, reply) => {
      const failure = await pingDatabase();
      const uptimeSeconds = Math.round(process.uptime());

      if (failure === null) {
        return { db: "up", uptimeSeconds };
      }

      reply.status(503);
      return { db: "down", uptimeSeconds, detail: failure };
    },
  );
}
