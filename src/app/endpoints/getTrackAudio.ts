import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

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
> = async ({ params, headers, reply }) => {
  const user = await UserManager.fromToken(headers.authorization);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const compressed = await user.getTrackData(params.id);
  if (compressed === null) {
    return { status: 404, body: "Track not found" };
  }

  // Stored bytes are gzipped by the uploader; byte ranges address the
  // decompressed audio (see the contract's description of this route).
  const audio = Buffer.from(Bun.gunzipSync(new Uint8Array(compressed)));

  reply.header("accept-ranges", "bytes");

  const rangeHeader = Array.isArray(headers.range)
    ? headers.range[0]
    : headers.range;
  if (rangeHeader !== undefined) {
    const range = parseByteRange(rangeHeader, audio.length);
    if (range === "unsatisfiable") {
      reply.header("content-range", `bytes */${audio.length}`);
      return { status: 416, body: "Range not satisfiable" };
    }
    if (range !== "ignore") {
      reply.header(
        "content-range",
        `bytes ${range.start}-${range.end}/${audio.length}`,
      );
      return { status: 206, body: audio.subarray(range.start, range.end + 1) };
    }
  }

  return { status: 200, body: audio };
};
