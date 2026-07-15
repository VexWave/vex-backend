import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const editArtist: AppRouteImplementation<
  typeof ApiContract.editArtist
> = async ({ body, headers }) => {
  const user = await UserManager.fromToken(headers.authorization);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const { id, name, image } = body;

  if (name === undefined && image === undefined) {
    return { status: 400, body: "Nothing to update" };
  }

  const result = await user.updateArtist(id, { name, image });
  if (result === "not_found") {
    return { status: 404, body: "Artist not found" };
  }

  return { status: 200, body: String(id) };
};
