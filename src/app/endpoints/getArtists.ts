import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const getArtists: AppRouteImplementation<
  typeof ApiContract.getArtists
> = async ({ headers }) => {
  const user = await UserManager.fromToken(headers.authorization);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const artists = await user.listArtists();

  return { status: 200, body: artists };
};
