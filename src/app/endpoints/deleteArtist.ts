import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const deleteArtist: AppRouteImplementation<
  typeof ApiContract.deleteArtist
> = async ({ body, headers }) => {
  const user = await UserManager.fromToken(headers.authorization);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const deleted = await user.deleteArtist(body.id);
  if (!deleted) {
    return { status: 404, body: "Artist not found" };
  }

  return { status: 200, body: String(body.id) };
};
