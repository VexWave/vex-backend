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

// All user-scoped data access. Every read and write is filtered by the
// user's id, so a caller can never touch another user's rows.
export class UserManager {
  private constructor(readonly userId: number) {}

  // Resolve the requesting user; null = unauthorized. The `requireAuth` hook
  // has already resolved the token in `onRequest` and left the id on the
  // request, so the common path costs no query at all; the fallback covers
  // routes the gate lets through without a lookup.
  static async fromRequest(
    request: FastifyRequest,
  ): Promise<UserManager | null> {
    const userId =
      request.userId ??
      (await getUserIdFromToken(request.headers.authorization));
    return userId === null ? null : new UserManager(userId);
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
        // Full replacement of the track's artist links
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

  // Returns false when the track doesn't exist or belongs to another user.
  async deleteTrack(id: string): Promise<boolean> {
    const deleted = await db
      .delete(track)
      .where(this.ownTrack(id))
      .returning({ id: track.id });
    return deleted.length > 0;
  }

  // Tracks in the shape the contract's TrackResponse expects. `coverUrl` points
  // at the getTrackImage route when the track has a cover; the (potentially
  // large) cover bytes are never loaded here — we only probe for their
  // presence via the `hasCover` extra.
  //
  // Ordered by `createdAt` because the contract promises oldest first and a
  // uuid id sorts arbitrarily — the client derives "newest uploads" from this
  // order alone.
  async listTracks(): Promise<
    {
      id: string;
      title: string;
      duration: number;
      artists: string[];
      coverUrl?: string;
    }[]
  > {
    const rows = await db.query.track.findMany({
      columns: { id: true, title: true, durationMs: true },
      extras: {
        hasCover: (t, { sql }) => sql<boolean>`${t.cover} is not null`,
      },
      where: { userId: this.userId },
      with: { artists: { columns: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      duration: row.durationMs,
      artists: row.artists.map((a) => a.name),
      coverUrl: row.hasCover ? trackImagePath(row.id) : undefined,
    }));
  }

  // Size of a track's stored audio in bytes, or null when the track doesn't
  // exist or belongs to another user. `octet_length` is evaluated in Postgres,
  // so answering a `Range` request costs nothing until the bytes are asked for
  // — and an unsatisfiable range costs nothing at all.
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

  // A slice of a track's stored audio: `length` bytes from the zero-based
  // offset `start`, or null when the track doesn't exist or belongs to another
  // user. Postgres' `substring` does the slicing, so serving a seek costs the
  // size of the slice instead of the size of the track — the difference
  // between a handful of kilobytes and a hundred megabytes per request, every
  // time a client seeks.
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

  // Artists in the shape the contract's ArtistResponse expects. `imageUrl` points
  // at the getArtistImage route when the artist has an image; the (potentially
  // large) image bytes are never loaded here — we only probe for their
  // presence via the `hasImage` extra.
  async listArtists(): Promise<
    { id: number; name: string; imageUrl?: string }[]
  > {
    const rows = await db.query.artist.findMany({
      columns: { id: true, name: true },
      extras: {
        hasImage: (t, { sql }) => sql<boolean>`${t.image} is not null`,
      },
      where: { userId: this.userId },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      imageUrl: row.hasImage ? artistImagePath(row.id) : undefined,
    }));
  }

  // Updates an artist's name and/or avatar image (`image: null` removes it).
  // The ownership filter is part of the WHERE clause, so another user's artist
  // is treated as not found.
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

  // Unlinks the artist from its tracks (via ON DELETE CASCADE); the tracks
  // themselves are kept. Returns false when not found or owned by another user.
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
    // `image: null` removes the cover; `undefined` leaves a field unchanged.
    // `trackIds` fully replaces the ordered track list (an empty array
    // clears it).
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
        // Full replacement of the ordered track list
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

  // Removes the playlist and (via ON DELETE CASCADE) its entries; the tracks
  // themselves are kept. Returns false when not found or owned by another user.
  async deletePlaylist(id: number): Promise<boolean> {
    const deleted = await db
      .delete(playlist)
      .where(this.ownPlaylist(id))
      .returning({ id: playlist.id });
    return deleted.length > 0;
  }

  // Playlists in the shape the contract's PlaylistResponse expects, each with
  // its complete ordered `trackIds` (deleted tracks are cascaded out of the
  // entries table, so dangling ids can't appear). `imageUrl` points at the
  // getPlaylistImage route when the playlist has a cover; the (potentially
  // large) image bytes are never loaded here — we only probe for their
  // presence via the `hasImage` extra.
  async listPlaylists(): Promise<
    {
      id: number;
      name: string;
      trackIds: string[];
      imageUrl?: string;
    }[]
  > {
    const rows = await db.query.playlist.findMany({
      columns: { id: true, name: true },
      extras: {
        hasImage: (t, { sql }) => sql<boolean>`${t.image} is not null`,
      },
      where: { userId: this.userId },
      with: {
        entries: { columns: { trackId: true }, orderBy: { position: "asc" } },
      },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      trackIds: row.entries.map((entry) => entry.trackId),
      imageUrl: row.hasImage ? playlistImagePath(row.id) : undefined,
    }));
  }

  // --- Ownership helpers ---

  // SQL filter matching a track only when it belongs to this user, so writes
  // enforce ownership themselves instead of trusting an earlier check.
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

  // SQL filter matching a playlist only when it belongs to this user, so writes
  // enforce ownership themselves instead of trusting an earlier check.
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

  // Callers pass duplicate-free ids (the contract rejects duplicate playlist
  // track ids), so a plain count comparison suffices.
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
