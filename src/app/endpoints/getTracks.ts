import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const getTracks: AppRouteImplementation<
  typeof ApiContract.getTracks
> = async ({ headers }) => {
  const user = await UserManager.fromToken(headers.authorization);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const tracks = await user.listTracks();

  return { status: 200, body: tracks };
};
