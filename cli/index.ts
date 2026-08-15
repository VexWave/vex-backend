// Admin CLI — the operator side of the server, for what the API has no route
// for: creating accounts, rotating passwords, revoking sessions, deleting users.
//
//   bun run cli
//
// Interactive only, no flags. Reads the same `.env` as the server and talks
// straight to the database, so it needs no running server. Menus are in
// `cli/menu.ts`; this file is only process lifecycle.

import * as p from "@clack/prompts";
import { z } from "zod";
import { messageOf } from "../src/logger";
import { Cancelled } from "./ui";

// Imported inside the `try`, not at the top: `src/env.ts` validates the
// environment at import time and `src/db` imports it, so a static import would
// throw a zod stack trace nothing here could catch.
try {
  const { run } = await import("./menu");
  await run();
} catch (error) {
  if (error instanceof Cancelled) {
    p.cancel("Cancelled.");
  } else if (error instanceof z.ZodError) {
    // The only zod that reaches here is `src/env.ts`; clack's validators report
    // their issues to the prompt instead of throwing.
    p.cancel(
      "The environment is not configured. Copy .env.example to .env and set DATABASE_URL.",
    );
    process.exitCode = 1;
  } else {
    // Through `messageOf`, never the error itself: drizzle puts the failed
    // query's parameters in both `.message` and `.params`, and here those are
    // password hashes and session tokens. `messageOf` strips them.
    p.cancel("Something went wrong.");
    console.error(messageOf(error));
    process.exitCode = 1;
  }
} finally {
  // Cached if the run above already opened it; `catch` covers never getting
  // that far. Without the `end()` the process hangs on the open pool.
  const opened = await import("../src/db").catch(() => null);
  await opened?.db.$client.end();
}
