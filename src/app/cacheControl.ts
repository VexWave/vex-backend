// Every `Cache-Control` value this API issues, in one place: what the server
// promises about a response is far easier to check when the whole vocabulary
// can be read at once.
//
// A year is the longest age RFC 9111 asks a cache to treat as "forever", and
// `immutable` stops a client revalidating on a manual reload as well. Both are
// only ever paired with a URL that addresses one specific version of the bytes
// — an image URL carrying its content hash, or a track id, whose audio is
// written once and never replaced.
const FOREVER = "max-age=31536000, immutable";

/** Public bytes, pinned by the URL to the version being served. */
export const PUBLIC_FOREVER = `public, ${FOREVER}`;

/**
 * Public bytes the caller has no version for: it pinned none, or pinned one
 * that has since been replaced. Keeping a copy is fine, trusting that copy
 * without asking again is not.
 */
export const PUBLIC_REVALIDATE = "public, no-cache";

/**
 * Per-user bytes that never change for a given URL. The caller may keep them
 * for good; a shared cache may not hold them at all, since the next caller is
 * a different user.
 */
export const PRIVATE_FOREVER = `private, ${FOREVER}`;

/** Not to be stored at all: every per-session body, and every failure. */
export const NO_STORE = "no-store";
