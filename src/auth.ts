import { db } from "./db";

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// Hash of a random string, computed once on first use. Logging in as a
// username that doesn't exist verifies against this instead of returning
// straight away: argon2 dominates the cost of a login, so skipping it would
// make a miss answer measurably faster than a wrong password and let anyone
// enumerate which accounts exist.
let dummyHash: Promise<string> | undefined;

export async function verifyAgainstDummyHash(password: string): Promise<void> {
  dummyHash ??= hashPassword(generateToken());
  await verifyPassword(password, await dummyHash);
}

// Opaque 256-bit session token, url-safe.
export function generateToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

// Resolves the `authorization` header (a session token) to its user id, or
// null if the token is missing/unknown. Accepts the raw Fastify header type.
export async function getUserIdFromToken(
  header: string | string[] | undefined,
): Promise<number | null> {
  const token = Array.isArray(header) ? header[0] : header;
  if (!token) return null;

  const row = await db.query.session.findFirst({
    where: { token: token },
  });

  return row?.userId ?? null;
}
