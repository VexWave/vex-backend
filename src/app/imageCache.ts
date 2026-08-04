import { env } from "../env";
import { etagMatches } from "../utils";
import { PUBLIC_FOREVER, PUBLIC_REVALIDATE } from "./cacheControl";

/**
 * Served image bytes held in this process.
 *
 * Entries are keyed by content — route, row id and the hash of the bytes — so
 * nothing ever has to be invalidated: editing an image asks for a key that
 * isn't there yet, and the superseded entry is simply never requested again
 * and ages out. No write path needs to know this cache exists.
 *
 * The budget counts bytes rather than entries. Entries are whole images and
 * differ in size by orders of magnitude, so a count would put no useful
 * ceiling on the memory this holds.
 */
class ImageCache {
  private readonly entries = new Map<string, Buffer>();
  private bytes = 0;

  constructor(private readonly budget: number) {}

  // What one entry costs against the budget: the image, plus an allowance for
  // the key and the map's own bookkeeping. The allowance is what stops an
  // empty image — `z.base64()` accepts `""`, so uploading one is legal — from
  // being free to hold: a zero-cost entry never counts towards the ceiling,
  // and so is never what eviction reclaims.
  private costOf(image: Buffer): number {
    return image.byteLength + 256;
  }

  get(key: string): Buffer | undefined {
    const hit = this.entries.get(key);
    if (hit === undefined) {
      return undefined;
    }
    // Re-inserting moves the key to the back, which keeps the map ordered
    // least- to most-recently-used — the order eviction below relies on.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: string, image: Buffer): void {
    const cost = this.costOf(image);
    // An image bigger than the entire budget would evict everything else and
    // still not fit. Because every entry costs something, this is also what
    // makes a budget of 0 a cache that stores nothing, as documented.
    if (cost > this.budget) {
      return;
    }

    this.drop(key);
    this.entries.set(key, image);
    this.bytes += cost;

    // Oldest first, until the budget is met again. Deleting the current key
    // mid-iteration is well defined for a Map, so one walk covers the whole
    // burst — the entry just inserted fits, so it is never reached.
    for (const oldest of this.entries.keys()) {
      if (this.bytes <= this.budget) {
        return;
      }
      this.drop(oldest);
    }
  }

  private drop(key: string): void {
    const existing = this.entries.get(key);
    if (existing === undefined) {
      return;
    }
    this.entries.delete(key);
    this.bytes -= this.costOf(existing);
  }
}

const cache = new ImageCache(env.IMAGE_CACHE_BYTES);

type ImageKind = "artist" | "track" | "playlist";

/** An image's stored bytes together with the hash that versions them. */
export type StoredImage = { bytes: Buffer; hash: string };

/**
 * Pairs an image column with the hash column Postgres generates from it. The
 * two are null together by construction, so either one being null means the
 * row has no image — testing both is what tells the type checker that.
 */
export function toStoredImage(
  bytes: Buffer | null,
  hash: string | null,
): StoredImage | null {
  return bytes === null || hash === null ? null : { bytes, hash };
}

// The route and row as well as the hash: a caller writes the version into the
// URL, so keying on the hash alone would let any cached image be served from
// any id that asked for its hash.
const keyOf = (kind: ImageKind, id: string | number, hash: string) =>
  `${kind}:${id}:${hash}`;

type ImageResponse =
  { status: 200; body: Buffer } | { status: 304; body: undefined };

// Nothing here does more to the reply than set headers on it, and asking for
// no more than that is also what keeps it assignable: ts-rest passes the reply
// with its generic parameters in the order Fastify 4 declared them, so a plain
// `FastifyReply` no longer matches what an endpoint has in hand.
type HeaderSink = { header(name: string, value: string): unknown };

/**
 * Answers one of the image routes: serves the bytes `load` produces, tagged so
 * that a client can hold on to them and revalidate cheaply, and straight from
 * memory when the caller pinned a version this process has served before.
 *
 * Returns null when there is no such image, which leaves the 404 — and its
 * wording — to the endpoint.
 */
export async function serveImage(input: {
  kind: ImageKind;
  id: string | number;
  /** The version the caller pinned via `?v=`, if it pinned one. */
  version: string | undefined;
  /** The caller's `If-None-Match`, which decides between `200` and `304`. */
  ifNoneMatch: string | undefined;
  reply: HeaderSink;
  load: () => Promise<StoredImage | null>;
}): Promise<ImageResponse | null> {
  const { kind, id, version, ifNoneMatch, reply, load } = input;

  // A pinned version names exactly which bytes are wanted, so a hit can be
  // served without a query at all. This is the path that keeps a screenful of
  // covers off the database entirely.
  let image: StoredImage | null = null;
  if (version !== undefined) {
    const bytes = cache.get(keyOf(kind, id, version));
    if (bytes !== undefined) {
      image = { bytes, hash: version };
    }
  }

  if (image === null) {
    image = await load();
    if (image === null) {
      return null;
    }
    cache.set(keyOf(kind, id, image.hash), image.bytes);
  }

  const etag = `"${image.hash}"`;
  reply.header("etag", etag);

  // Only bytes the URL actually named may be kept for good. Answering a
  // superseded pin with the current bytes is right — the caller wants the
  // image, and its next listing carries the new URL — but they must not then
  // be cached as if they were the version that was asked for, since the caller
  // has no way to know when that stops being true. On the cache hit above the
  // two are equal by construction: the key was built from `version`.
  reply.header(
    "cache-control",
    version === image.hash ? PUBLIC_FOREVER : PUBLIC_REVALIDATE,
  );

  return etagMatches(ifNoneMatch, etag)
    ? { status: 304, body: undefined }
    : { status: 200, body: image.bytes };
}
