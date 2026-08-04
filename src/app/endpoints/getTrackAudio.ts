import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";
import { etagMatches } from "../../utils";

// Parses a single-range `Range` header against a body of `size` bytes.
// - { start, end }: satisfiable range (inclusive bounds)
// - "unsatisfiable": syntactically valid but out of bounds -> 416
// - "ignore": malformed or multi-range -> serve the full body (RFC 9110 §14.2
//   allows ignoring the header instead of erroring)
function parseByteRange(
  header: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | "ignore" {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) {
    return "ignore";
  }
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") {
    return "ignore";
  }

  if (startStr === "") {
    // Suffix range: last N bytes
    const suffix = Number(endStr);
    if (suffix === 0 || size === 0) {
      return "unsatisfiable";
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startStr);
  const end = endStr === "" ? size - 1 : Number(endStr);
  if (endStr !== "" && end < start) {
    return "ignore";
  }
  if (start >= size) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(end, size - 1) };
}

export const getTrackAudio: AppRouteImplementation<
  typeof ApiContract.getTrackAudio
> = async ({ params, headers, request, reply }) => {
  const user = await UserManager.fromRequest(request);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  // Only the length is read up front. The bytes are fetched once the range is
  // known, so a seek — or a range that turns out to be unsatisfiable — never
  // pulls a whole track into memory.
  const size = await user.getTrackAudioSize(params.id);
  if (size === null) {
    return { status: 404, body: "Track not found" };
  }

  reply.header("accept-ranges", "bytes");

  // A track's audio is written once and never replaced, so its id identifies
  // those bytes for as long as they exist — a validator already at hand, where
  // a content hash would mean digesting up to 75 MiB on every upload to say
  // the same thing. Checked after the lookup above so that a `304` is only
  // ever an answer about a track this caller owns.
  const etag = `"${params.id}"`;
  reply.header("etag", etag);
  if (etagMatches(request.headers["if-none-match"], etag)) {
    return { status: 304, body: undefined };
  }

  const rangeHeader = Array.isArray(headers.range)
    ? headers.range[0]
    : headers.range;

  let start = 0;
  let end = size - 1;
  let partial = false;

  if (rangeHeader !== undefined) {
    const range = parseByteRange(rangeHeader, size);
    if (range === "unsatisfiable") {
      reply.header("content-range", `bytes */${size}`);
      return { status: 416, body: "Range not satisfiable" };
    }
    if (range !== "ignore") {
      ({ start, end } = range);
      partial = true;
    }
  }

  const body = await user.getTrackAudioRange(params.id, start, end - start + 1);
  // The track can have been deleted between the two queries.
  if (body === null) {
    return { status: 404, body: "Track not found" };
  }

  if (!partial) {
    return { status: 200, body };
  }

  reply.header("content-range", `bytes ${start}-${end}/${size}`);
  return { status: 206, body };
};
