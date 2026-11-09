import { assertAuthActive, createAuthEpoch } from "@mains/contracts/auth-lifecycle";

interface CredentialStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

/** Native keychain writes cannot be aborted. Serialize their commit/rollback
 * with subsequent writes, reads and forget so an abandoned candidate is never
 * returned as a confirmed pairing. */
export function createCredentialPersistence(storage: CredentialStorage) {
  const epoch = createAuthEpoch();
  let tail: Promise<void> = Promise.resolve();
  let rollback: { candidate: string; previous: string | null } | null = null;

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.then(() => {}, () => {});
    return result;
  }

  async function recover(): Promise<void> {
    const pending = rollback;
    if (!pending) return;
    if (await storage.read() === pending.candidate) {
      if (pending.previous === null) await storage.remove();
      else await storage.write(pending.previous);
    }
    // A failed restoration leaves the checkpoint intact. The next operation
    // must recover it before it can expose or replace the credential.
    rollback = null;
  }

  return {
    async load(): Promise<string | null> {
      for (;;) {
        const signal = epoch.signal;
        const value = await enqueue(async () => { await recover(); return storage.read(); });
        if (!signal.aborted) return value;
      }
    },
    save(candidate: string, signal?: AbortSignal): Promise<void> {
      epoch.retire();
      const intent = epoch.signal;
      const assertCurrent = () => { assertAuthActive(intent); assertAuthActive(signal); };
      return enqueue(async () => {
        assertCurrent();
        await recover();
        const previous = await storage.read();
        assertCurrent();
        rollback = { candidate, previous };
        try {
          await storage.write(candidate);
          assertCurrent();
          rollback = null;
        } catch (error) {
          await recover();
          throw error;
        }
      });
    },
    forget(): Promise<void> {
      epoch.retire();
      return enqueue(async () => { await storage.remove(); rollback = null; });
    },
  };
}
