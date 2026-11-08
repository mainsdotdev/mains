import { afterEach, expect, it } from "vitest";
import { acceptFileWrite, openFileWrites, shutdownFileWrites } from "./file-write-lifecycle";
afterEach(async () => { await shutdownFileWrites(); openFileWrites(); });
it("fences new editor writes and drains an already admitted write before closing", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const accepted = acceptFileWrite(async () => { await gate; return "saved"; });
  let closed = false; const closing = shutdownFileWrites().then(() => { closed = true; });
  try { await expect(acceptFileWrite(async () => "late")).rejects.toThrow("shutting down"); expect(closed).toBe(false); }
  finally { release(); await accepted; await closing; }
  openFileWrites(); await expect(acceptFileWrite(async () => "new")).resolves.toBe("new");
});
