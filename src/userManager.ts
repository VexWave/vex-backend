import { and, eq } from "drizzle-orm";
import { getUserIdFromToken } from "./auth";
import { db } from "./db";
import { artist, artistToTrack, track } from "./db/schema";
import { artistImagePath, trackImagePath } from "../contract/contract";

// All user-scoped data access. Every read and write is filtered by the
// user's id, so a caller can never touch another user's rows.
export class UserManager {
  private constructor(readonly userId: number) {}

  // Resolve the requesting user from the authorization header; null = unauthorized.
  static async fromToken(
    authorization: string | string[] | undefined,
  ): Promise<UserManager | null> {
    const userId = await getUserIdFromToken(authorization);
    return userId === null ? null : new UserManager(userId);
  }

  // --- Tracks ---

  async createTrack(values: {
    title: string;
    durationMs: number;
    compressed_data: Buffer;
    cover?: Buffer;
    artistIds?: number[];
  }): Promise<number | "invalid_artists" | null> {
    // Dedupe: the junction table's PK is (artistId, trackId)
    const artistIds =
      values.artistIds === undefined
        ? undefined
        : [...new Set(values.artistIds)];
    if (artistIds !== undefined && !(await this.ownsAllArtists(artistIds))) {
      return "invalid_artists";
    }

    const { title, durationMs, compressed_data, cover } = values;
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(track)
        .values({
          title,
          durationMs,
          compressed_data,
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
    id: number,
    changes: { title?: string; artistIds?: number[] },
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

    await db.transaction(async (tx) => {
      if (changes.title !== undefined) {
        await tx
          .update(track)
          .set({ title: changes.title })
          .where(this.ownTrack(id));
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
  async deleteTrack(id: number): Promise<boolean> {
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
  async listTracks(): Promise<
    {
      id: number;
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
      orderBy: { id: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      duration: row.durationMs,
      artists: row.artists.map((a) => a.name),
      coverUrl: row.hasCover ? trackImagePath(row.id) : undefined,
    }));
  }

  // Returns the stored (still compressed) audio bytes, or null when the track
  // doesn't exist or belongs to another user.
  async getTrackData(id: number): Promise<Buffer | null> {
    const row = await db.query.track.findFirst({
      columns: { compressed_data: true },
      where: { id, userId: this.userId },
    });
    return row?.compressed_data ?? null;
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

  // Updates an artist's name and/or avatar image. The ownership filter is part
  // of the WHERE clause, so another user's artist is treated as not found.
  async updateArtist(
    id: number,
    changes: { name?: string; image?: Buffer },
  ): Promise<"updated" | "not_found"> {
    const values: { name?: string; image?: Buffer } = {};
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

  // --- Ownership helpers ---

  // SQL filter matching a track only when it belongs to this user, so writes
  // enforce ownership themselves instead of trusting an earlier check.
  private ownTrack(id: number) {
    return and(eq(track.id, id), eq(track.userId, this.userId));
  }

  private async ownsTrack(id: number): Promise<boolean> {
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
}
