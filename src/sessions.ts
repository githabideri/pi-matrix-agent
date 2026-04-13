import { createHash } from "crypto";
import { mkdir, rm } from "fs/promises";

export type SessionFactory<T> = (sessionDir: string) => Promise<T>;

export class SessionRegistry<T> {
  private cache = new Map<string, T>();
  private factory: SessionFactory<T>;
  private baseDir: string;

  constructor(factory: SessionFactory<T>, baseDir: string) {
    this.factory = factory;
    this.baseDir = baseDir;
  }

  private hashRoomId(roomId: string): string {
    return createHash("sha256").update(roomId).digest("hex").slice(0, 16);
  }

  private getSessionDir(roomId: string): string {
    const hashed = this.hashRoomId(roomId);
    return `${this.baseDir}/${hashed}`;
  }

  async get(roomId: string): Promise<T> {
    const cached = this.cache.get(roomId);
    if (cached) {
      return cached;
    }

    const sessionDir = this.getSessionDir(roomId);
    await mkdir(sessionDir, { recursive: true });

    const session = await this.factory(sessionDir);
    this.cache.set(roomId, session);
    return session;
  }

  async drop(roomId: string): Promise<void> {
    // Remove from cache
    this.cache.delete(roomId);

    // Also delete the session directory to clear persisted history
    const sessionDir = this.getSessionDir(roomId);
    try {
      await rm(sessionDir, { recursive: true, force: true });
    } catch (_err) {
      // Ignore errors - directory might not exist
    }
  }
}
