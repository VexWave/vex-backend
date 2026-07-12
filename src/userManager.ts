import { and, eq } from "drizzle-orm";
import { getUserIdFromToken } from "./auth";
import { db } from "./db";
import { artist, artistToTrack, track } from "./db/schema";

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
  }): Promise<number | null> {
    const [created] = await db
      .insert(track)
      .values({ ...values, userId: this.userId })
      .returning({ id: track.id });
    return created?.id ?? null;
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
        await tx.update(track).set({ title: changes.title }).where(this.ownTrack(id));
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

  // --- Artists ---

  async createArtist(values: {
    name: string;
    imageUrl?: string;
  }): Promise<number | null> {
    const [created] = await db
      .insert(artist)
      .values({ ...values, userId: this.userId })
      .returning({ id: artist.id });
    return created?.id ?? null;
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
