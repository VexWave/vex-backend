// Read-only views of what a user owns.

import * as p from "@clack/prompts";
import { UserManager } from "../src/userManager";
import { duration, plural, table, type Column } from "./ui";
import type { UserRow } from "./users";

/** `imageUrl`/`coverUrl` are set exactly when the image exists. */
const has = (url: string | undefined): string =>
  url === undefined ? "—" : "yes";

function view<Item>(
  row: UserRow,
  noun: string,
  items: Item[],
  columns: Column<Item>[],
): void {
  if (items.length === 0) {
    p.log.info(`${row.username} has no ${noun}s.`);
    return;
  }
  p.note(
    table(columns, items),
    `${plural(items.length, noun)} — ${row.username}`,
  );
}

export async function viewTracks(row: UserRow): Promise<void> {
  const manager = UserManager.forUserId(row.id);
  const [tracks, artists] = await Promise.all([
    manager.listTracks(),
    manager.listArtists(),
  ]);
  const names = new Map(artists.map((a) => [a.id, a.name] as const));
  view(row, "track", tracks, [
    { header: "title", value: (t) => t.title, max: 44 },
    {
      header: "artists",
      value: (t) =>
        t.artistIds.length === 0
          ? "—"
          : t.artistIds.map((id) => names.get(id) ?? "?").join(", "),
      max: 28,
    },
    { header: "length", value: (t) => duration(t.duration), right: true },
    { header: "cover", value: (t) => has(t.coverUrl) },
  ]);
}

export async function viewArtists(row: UserRow): Promise<void> {
  view(row, "artist", await UserManager.forUserId(row.id).listArtists(), [
    { header: "id", value: (a) => String(a.id), right: true },
    { header: "name", value: (a) => a.name, max: 48 },
    { header: "image", value: (a) => has(a.imageUrl) },
  ]);
}

export async function viewPlaylists(row: UserRow): Promise<void> {
  view(row, "playlist", await UserManager.forUserId(row.id).listPlaylists(), [
    { header: "id", value: (l) => String(l.id), right: true },
    { header: "name", value: (l) => l.name, max: 48 },
    { header: "tracks", value: (l) => String(l.trackIds.length), right: true },
    { header: "image", value: (l) => has(l.imageUrl) },
  ]);
}
