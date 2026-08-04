/**
 * Whether an `If-None-Match` header covers `etag` — whether, that is, the
 * caller already holds this exact version and can be sent a bare `304` instead
 * of the bytes.
 *
 * The header carries a comma-separated list rather than a single tag, and a
 * cache is allowed to hand back a weakened form of what it stored (`W/"…"`).
 * Both forms mean the same thing here, since every tag this server issues is a
 * strong one.
 */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) {
    return false;
  }
  if (header.trim() === "*") {
    return true;
  }
  return header
    .split(",")
    .some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
}

type Result<T> = [T, null] | [null, Error];

export async function tryCatch<T extends Promise<unknown>>(
  promise: T,
): Promise<Result<Awaited<T>>> {
  try {
    const result = await promise;
    return [result, null] as Result<Awaited<T>>;
  } catch (error) {
    return [null, error instanceof Error ? error : new Error(String(error))];
  }
}
