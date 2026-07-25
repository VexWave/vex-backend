import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const postPlaylist: AppRouteImplementation<
  typeof ApiContract.postPlaylist
> = async ({ body, headers }) => {
  const user = await UserManager.fromToken(headers.authorization);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const { name, desc, image, trackIds } = body;

  const id = await user.createPlaylist({ name, desc, image, trackIds });
  if (id === "invalid_tracks") {
    return { status: 400, body: "One or more track ids are invalid" };
  }
  if (id === null) {
    return { status: 500, body: "Failed to create playlist" };
  }

  return { status: 200, body: String(id) };
};
