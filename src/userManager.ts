import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { getUserIdFromToken } from "./auth";
import { db } from "./db";
import {
  artist,
  artistToTrack,
  playlist,
  playlistTrack,
  track,
} from "./db/schema";
import {
  artistImagePath,
  playlistImagePath,
  trackImagePath,
} from "../contract/contract";

// A `*Hash` is generated from the image bytes, so it says both that an image
// exists and which version it is, without ever reading them.
const toTrack = (row: {
  id: string;
  title: string;
  durationMs: number;
  coverHash: string | null;
  artists: { id: number }[];
}) => ({
  id: row.id,
  title: row.title,
  duration: row.durationMs,
  artistIds: row.artists.map((a) => a.id),
  coverUrl:
    row.coverHash === null ? undefined : trackImagePath(row.id, row.coverHash),
});

const toArtist = (row: {
  id: number;
  name: string;
  imageHash: string | null;
}) => ({
  id: row.id,
  name: row.name,
  imageUrl:
    row.imageHash === null ? undefined : artistImagePath(row.id, row.imageHash),
});

const toPlaylist = (row: {
  id: number;
  name: string;
  imageHash: string | null;
  entries: { trackId: string }[];
}) => ({
  id: row.id,
  name: row.name,
  trackIds: row.entries.map((e) => e.trackId),
  imageUrl:
    row.imageHash === null
      ? undefined
      : playlistImagePath(row.id, row.imageHash),
});

// Every read and write here is filtered by `userId`, so a caller can never
// touch another user's rows.
export class UserManager {
  private constructor(readonly userId: number) {}

  // `requireAuth` already left the resolved id on the request, so the common
  // path costs no query; the fallback covers routes the gate lets through.
  static async fromRequest(
    request: FastifyRequest,
  ): Promise<UserManager | null> {
    const userId =
      request.userId ??
      (await getUserIdFromToken(request.headers.authorization));
    return userId === null ? null : new UserManager(userId);
  }

  // For `cli/` only: scoped to `userId`, but with no proof the caller owns it,
  // so nothing serving HTTP may use this.
  static forUserId(userId: number): UserManager {
    return new UserManager(userId);
  }

  // --- Library ---

  // One statement, so Postgres evaluates it against a single snapshot and
  // `artistIds` / `trackIds` resolve against the rows sent beside them.
  async listData() {
    const row = await db.query.user.findFirst({
      columns: { id: true },
      where: { id: this.userId },
      with: {
        tracks: {
          columns: { id: true, title: true, durationMs: true, coverHash: true },
          with: { artists: { columns: { id: true }, orderBy: { id: "asc" } } },
          orderBy: { createdAt: "asc", id: "asc" },
        },
        artists: {
          columns: { id: true, name: true, imageHash: true },
          orderBy: { id: "asc" },
        },
        playlists: {
          columns: { id: true, name: true, imageHash: true },
          with: {
            entries: {
              columns: { trackId: true },
              orderBy: { position: "asc" },
            },
          },
          orderBy: { id: "asc" },
        },
      },
    });
    return {
      tracks: row?.tracks.map(toTrack) ?? [],
      artists: row?.artists.map(toArtist) ?? [],
      playlists: row?.playlists.map(toPlaylist) ?? [],
    };
  }

  // --- Tracks ---

  async createTrack(values: {
    title: string;
    durationMs: number;
    data: Buffer;
    cover?: Buffer;
    artistIds?: number[];
  }): Promise<string | "invalid_artists" | null> {
    // Dedupe: the junction table's PK is (artistId, trackId)
    const artistIds =
      values.artistIds === undefined
        ? undefined
        : [...new Set(values.artistIds)];
    if (artistIds !== undefined && !(await this.ownsAllArtists(artistIds))) {
      return "invalid_artists";
    }

    const { title, durationMs, data, cover } = values;
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(track)
        .values({
          title,
          durationMs,
          data,
          cover,
          userId: this.userId,
        })
        .returning({ id: track.id });
      if (created === undefined) {
        return null;
      }
      if (artistIds !== undefined && artistIds.length > 0) {
        await tx
          .insert(artistToTrack)
          .values(
            artistIds.map((artistId) => ({ artistId, trackId: created.id })),
          );
      }
      return created.id;
    });
  }

  async updateTrack(
    id: string,
    // `cover: null` removes the stored cover; `undefined` leaves it unchanged.
    changes: { title?: string; cover?: Buffer | null; artistIds?: number[] },
  ): Promise<"updated" | "not_found" | "invalid_artists"> {
    // Dedupe: the junction table's PK is (artistId, trackId)
    const artistIds =
      changes.artistIds === undefined
        ? undefined
        : [...new Set(changes.artistIds)];

    if (!(await this.ownsTrack(id))) {
      return "not_found";
    }
    if (artistIds !== undefined && !(await this.ownsAllArtists(artistIds))) {
      return "invalid_artists";
    }

    const values: { title?: string; cover?: Buffer | null } = {};
    if (changes.title !== undefined) {
      values.title = changes.title;
    }
    if (changes.cover !== undefined) {
      values.cover = changes.cover;
    }

    await db.transaction(async (tx) => {
      if (Object.keys(values).length > 0) {
        await tx.update(track).set(values).where(this.ownTrack(id));
      }
      if (artistIds !== undefined) {
        await tx.delete(artistToTrack).where(eq(artistToTrack.trackId, id));
        if (artistIds.length > 0) {
          await tx
            .insert(artistToTrack)
            .values(artistIds.map((artistId) => ({ artistId, trackId: id })));
        }
      }
    });
    return "updated";
  }

  async deleteTrack(id: string): Promise<boolean> {
    const deleted = await db
      .delete(track)
      .where(this.ownTrack(id))
      .returning({ id: track.id });
    return deleted.length > 0;
  }

  // Oldest first: a uuid sorts arbitrarily. The junction stores no position,
  // so `artistIds` is not the order the track was created with.
  async listTracks(): Promise<
    {
      id: string;
      title: string;
      duration: number;
      artistIds: number[];
      coverUrl?: string;
    }[]
  > {
    const rows = await db.query.track.findMany({
      columns: { id: true, title: true, durationMs: true, coverHash: true },
      where: { userId: this.userId },
      // Stable order; the junction's PK gives none.
      with: { artists: { columns: { id: true }, orderBy: { id: "asc" } } },
      // `createdAt` is transaction time, so it ties; `id` makes the sort total.
      orderBy: { createdAt: "asc", id: "asc" },
    });
    return rows.map(toTrack);
  }

  // `octet_length` runs in Postgres, so answering a `Range` request never
  // loads the audio.
  async getTrackAudioSize(id: string): Promise<number | null> {
    const row = await db.query.track.findFirst({
      columns: { id: true },
      extras: {
        size: (t, { sql }) => sql<number>`octet_length(${t.data})`,
      },
      where: { id, userId: this.userId },
    });
    return row?.size ?? null;
  }

  // `substring` runs in Postgres, so a seek costs the slice, not the track.
  async getTrackAudioRange(
    id: string,
    start: number,
    length: number,
  ): Promise<Buffer | null> {
    const row = await db.query.track.findFirst({
      columns: { id: true },
      extras: {
        // `substring` counts from 1.
        chunk: (t, { sql }) =>
          sql<Buffer>`substring(${t.data} from ${start + 1} for ${length})`,
      },
      where: { id, userId: this.userId },
    });
    return row?.chunk ?? null;
  }

  // --- Artists ---

  async createArtist(values: {
    name: string;
    image?: Buffer;
  }): Promise<number | null> {
    const [created] = await db
      .insert(artist)
      .values({ ...values, userId: this.userId })
      .returning({ id: artist.id });
    return created?.id ?? null;
  }

  async listArtists(): Promise<
    { id: number; name: string; imageUrl?: string }[]
  > {
    const rows = await db.query.artist.findMany({
      columns: { id: true, name: true, imageHash: true },
      where: { userId: this.userId },
      orderBy: { id: "asc" },
    });
    return rows.map(toArtist);
  }

  // `image: null` removes it; `undefined` leaves it unchanged.
  async updateArtist(
    id: number,
    changes: { name?: string; image?: Buffer | null },
  ): Promise<"updated" | "not_found"> {
    const values: { name?: string; image?: Buffer | null } = {};
    if (changes.name !== undefined) {
      values.name = changes.name;
    }
    if (changes.image !== undefined) {
      values.image = changes.image;
    }

    const updated = await db
      .update(artist)
      .set(values)
      .where(and(eq(artist.id, id), eq(artist.userId, this.userId)))
      .returning({ id: artist.id });
    return updated.length > 0 ? "updated" : "not_found";
  }

  // The artist's tracks are kept; only the links cascade away.
  async deleteArtist(id: number): Promise<boolean> {
    const deleted = await db
      .delete(artist)
      .where(and(eq(artist.id, id), eq(artist.userId, this.userId)))
      .returning({ id: artist.id });
    return deleted.length > 0;
  }

  // --- Playlists ---

  async createPlaylist(values: {
    name: string;
    image?: Buffer;
    trackIds?: string[];
  }): Promise<number | "invalid_tracks" | null> {
    const { name, image, trackIds } = values;
    if (trackIds !== undefined && !(await this.ownsAllTracks(trackIds))) {
      return "invalid_tracks";
    }

    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(playlist)
        .values({ name, image, userId: this.userId })
        .returning({ id: playlist.id });
      if (created === undefined) {
        return null;
      }
      if (trackIds !== undefined && trackIds.length > 0) {
        await tx.insert(playlistTrack).values(
          trackIds.map((trackId, position) => ({
            playlistId: created.id,
            trackId,
            position,
          })),
        );
      }
      return created.id;
    });
  }

  async updatePlaylist(
    id: number,
    // `image: null` removes the cover; `trackIds` fully replaces the ordered
    // list, an empty array clearing it.
    changes: {
      name?: string;
      image?: Buffer | null;
      trackIds?: string[];
    },
  ): Promise<"updated" | "not_found" | "invalid_tracks"> {
    const { trackIds } = changes;
    if (!(await this.ownsPlaylist(id))) {
      return "not_found";
    }
    if (trackIds !== undefined && !(await this.ownsAllTracks(trackIds))) {
      return "invalid_tracks";
    }

    const values: {
      name?: string;
      image?: Buffer | null;
    } = {};
    if (changes.name !== undefined) {
      values.name = changes.name;
    }
    if (changes.image !== undefined) {
      values.image = changes.image;
    }

    await db.transaction(async (tx) => {
      if (Object.keys(values).length > 0) {
        await tx.update(playlist).set(values).where(this.ownPlaylist(id));
      }
      if (trackIds !== undefined) {
        await tx.delete(playlistTrack).where(eq(playlistTrack.playlistId, id));
        if (trackIds.length > 0) {
          await tx.insert(playlistTrack).values(
            trackIds.map((trackId, position) => ({
              playlistId: id,
              trackId,
              position,
            })),
          );
        }
      }
    });
    return "updated";
  }

  // The playlist's tracks are kept; only its entries cascade away.
  async deletePlaylist(id: number): Promise<boolean> {
    const deleted = await db
      .delete(playlist)
      .where(this.ownPlaylist(id))
      .returning({ id: playlist.id });
    return deleted.length > 0;
  }

  // Deleted tracks cascade out of the entries table, so `trackIds` never
  // dangles.
  async listPlaylists(): Promise<
    {
      id: number;
      name: string;
      trackIds: string[];
      imageUrl?: string;
    }[]
  > {
    const rows = await db.query.playlist.findMany({
      columns: { id: true, name: true, imageHash: true },
      where: { userId: this.userId },
      with: {
        entries: { columns: { trackId: true }, orderBy: { position: "asc" } },
      },
      orderBy: { id: "asc" },
    });
    return rows.map(toPlaylist);
  }

  // --- Ownership helpers ---

  private ownTrack(id: string) {
    return and(eq(track.id, id), eq(track.userId, this.userId));
  }

  private async ownsTrack(id: string): Promise<boolean> {
    const row = await db.query.track.findFirst({
      columns: { id: true },
      where: { id, userId: this.userId },
    });
    return row !== undefined;
  }

  private async ownsAllArtists(ids: number[]): Promise<boolean> {
    if (ids.length === 0) {
      return true;
    }
    const owned = await db.query.artist.findMany({
      columns: { id: true },
      where: { id: { in: ids }, userId: this.userId },
    });
    return owned.length === ids.length;
  }

  private ownPlaylist(id: number) {
    return and(eq(playlist.id, id), eq(playlist.userId, this.userId));
  }

  private async ownsPlaylist(id: number): Promise<boolean> {
    const row = await db.query.playlist.findFirst({
      columns: { id: true },
      where: { id, userId: this.userId },
    });
    return row !== undefined;
  }

  // The contract rejects duplicate ids, so a count comparison suffices.
  private async ownsAllTracks(ids: string[]): Promise<boolean> {
    if (ids.length === 0) {
      return true;
    }
    const owned = await db.query.track.findMany({
      columns: { id: true },
      where: { id: { in: ids }, userId: this.userId },
    });
    return owned.length === ids.length;
  }
}
