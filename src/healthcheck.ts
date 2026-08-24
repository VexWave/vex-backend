import { env } from "./env";
import { clean, messageOf } from "./logger";

const TIMEOUT_MS = 3_000;

const HEALTH_URL = `http://127.0.0.1:${env.PORT}/health`;

function report(message: string, code: 0 | 1): never {
  (code === 0 ? process.stdout : process.stderr).write(message + "\n");
  process.exit(code);
}

const startedAt = performance.now();

let response: Response;
try {
  response = await fetch(HEALTH_URL, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
} catch (err) {
  report(
    `server: unreachable (${clean(messageOf(err) ?? "unknown error", 300)})`,
    1,
  );
}

const ms = Math.round(performance.now() - startedAt);

let parsed: unknown;
try {
  parsed = await response.json();
} catch {
  report(`health: ${response.status}, unreadable body`, 1);
}

if (typeof parsed !== "object" || parsed === null) {
  report(`health: ${response.status}, unexpected body`, 1);
}
const body = parsed as { db?: string; uptimeSeconds?: number; detail?: string };

if (body.db !== "up") {
  report(`db: down (${clean(body.detail ?? "no detail", 300)})`, 1);
}

if (!response.ok) {
  report(`health: ${response.status}`, 1);
}

report(`ok db=up up=${body.uptimeSeconds ?? "?"}s ${ms}ms`, 0);
