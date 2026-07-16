import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const postTrack: AppRouteImplementation<
  typeof ApiContract.postTrack
> = async ({ body, headers }) => {
  const user = await UserManager.fromToken(headers.authorization);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const { title, duration, compressed_data, cover, artistIds } = body;

  const id = await user.createTrack({
    title,
    durationMs: duration,
    compressed_data,
    cover,
    artistIds,
  });
  if (id === "invalid_artists") {
    return { status: 400, body: "One or more artist ids are invalid" };
  }
  if (id === null) {
    return { status: 500, body: "Failed to upload track" };
  }

  return { status: 200, body: String(id) };
};
