import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const editPlaylist: AppRouteImplementation<
  typeof ApiContract.editPlaylist
> = async ({ body, headers }) => {
  const user = await UserManager.fromToken(headers.authorization);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const { id, name, desc, image, trackIds } = body;

  if (
    name === undefined &&
    desc === undefined &&
    image === undefined &&
    trackIds === undefined
  ) {
    return { status: 400, body: "Nothing to update" };
  }

  const result = await user.updatePlaylist(id, { name, desc, image, trackIds });
  if (result === "not_found") {
    return { status: 404, body: "Playlist not found" };
  }
  if (result === "invalid_tracks") {
    return { status: 400, body: "One or more track ids are invalid" };
  }

  return { status: 200, body: String(id) };
};
