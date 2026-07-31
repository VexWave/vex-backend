import type { AppRouteImplementation } from "@ts-rest/fastify";
import { UserManager } from "../../userManager";
import { ApiContract } from "../../../contract/contract";

export const getTracks: AppRouteImplementation<
  typeof ApiContract.getTracks
> = async ({ request }) => {
  const user = await UserManager.fromRequest(request);
  if (user === null) {
    return { status: 401, body: "Unauthorized" };
  }

  const tracks = await user.listTracks();

  return { status: 200, body: tracks };
};
