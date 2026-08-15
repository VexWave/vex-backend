import { syncSchema } from "./db/sync";
import { flush } from "./discord";
import { events, notify } from "./events";

// Ahead of the import below, which starts listening as it loads: no request
// may arrive before the tables behind it exist.
try {
  const statements = await syncSchema();
  if (statements.length > 0) {
    notify(events.schemaSynced({ statements: statements.length }));
  }
} catch (err) {
  notify(events.schemaSyncFailed({ err }));
  await flush(2_000);
  process.exit(1);
}

await import("./app/server");
