/** Platform-neutral authorization generations. Retiring before an await
 * completes prevents the old continuation from publishing new credentials. */
export function createAuthEpoch() {
  let controller = new AbortController();
  return {
    get signal() { return controller.signal; },
    retire() { const previous = controller; controller = new AbortController(); previous.abort(); },
  };
}

export function assertAuthActive(signal: AbortSignal | undefined, message = "Authorization is no longer active"): void {
  if (!signal?.aborted) return;
  const error = new Error(message); error.name = "AbortError"; throw error;
}

/** Retire earlier proofs for one principal without refusing unrelated or
 * independently verified later handshakes. */
export function createAuthFence() {
  const epoch = createAuthEpoch(), retired = new Map<string, number>();
  let revision = 0;
  return {
    observe() {
      const started = revision, signal = epoch.signal;
      return (key: string) => !signal.aborted && (retired.get(key) ?? 0) <= started;
    },
    retire(key: string) { retired.set(key, ++revision); },
    clear() { epoch.retire(); retired.clear(); revision = 0; },
  };
}

export interface AuthGrant<T> {
  value: T;
  expiresAt: number;
  signal: AbortSignal;
  current(): boolean;
}

/** Opaque keys are supplied by the cryptographic boundary. Expiry, capacity,
 * consumption and clear all retire the same grant, including its live users. */
export function createAuthGrants<T>(maximum: number, now: () => number = () => Date.now()) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("Invalid authorization capacity");
  const entries = new Map<string, { grant: AuthGrant<T>; retire(): void }>();
  const epoch = createAuthEpoch();
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key); entry.retire();
  };
  const prune = () => { const at = now(); for (const [key, entry] of entries) if (entry.grant.expiresAt <= at) remove(key); };
  return {
    get signal() { return epoch.signal; },
    issue(key: string, value: T, expiresAt: number): AuthGrant<T> {
      prune(); remove(key);
      while (entries.size >= maximum) remove(entries.keys().next().value!);
      const controller = new AbortController();
      const grant: AuthGrant<T> = { value, expiresAt, signal: controller.signal, current: () => {
        if (entries.get(key)?.grant !== grant) return false;
        if (expiresAt <= now()) { remove(key); return false; }
        return true;
      } };
      entries.set(key, { grant, retire: () => controller.abort() });
      return grant;
    },
    get(key: string): AuthGrant<T> | null { prune(); return entries.get(key)?.grant ?? null; },
    take(key: string, accepts: (value: T) => boolean = () => true): T | null {
      prune(); const entry = entries.get(key);
      if (!entry || !accepts(entry.grant.value)) return null;
      remove(key); return entry.grant.value;
    },
    clear() {
      epoch.retire();
      const previous = [...entries.values()]; entries.clear();
      for (const entry of previous) entry.retire();
    },
  };
}
