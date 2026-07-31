import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const getPlaylists: AppRouteImplementation<
  typeof ApiContract.getPlaylists
> = async ({ request }) => {
  const user = await UserManager.fromRequest(request);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const playlists = await user.listPlaylists();

  return { status: 200, body: playlists };
};
