import { assertAuthActive, createAuthEpoch } from "@mains/contracts/auth-lifecycle";
import { parsePairingLink, type PairingLink } from "@mains/contracts/backend";
import type { PairedBackend } from "../../backend/paired-backend-store";

export type PairingState =
  | { kind: "scanning" } | { kind: "invalid" }
  | { kind: "detected" | "pairing" | "paired"; link: PairingLink }
  | { kind: "failed"; link: PairingLink; message: string };
interface PairingEffects {
  redeem(link: PairingLink, signal: AbortSignal): Promise<PairedBackend>;
  save(backend: PairedBackend, signal: AbortSignal): Promise<void>;
  complete(): void;
}
const identity = (link: PairingLink) => JSON.stringify([link.code, link.endpoints]);

/** One visible confirmation owns redemption and persistence. A new link or
 * detached screen retires preparation; confirmed persistence stays committed. */
export function createPairingFlow(initial: PairingLink | null, effects: PairingEffects) {
  const epoch = createAuthEpoch(), listeners = new Set<() => void>();
  let state: PairingState = initial ? { kind: "detected", link: initial } : { kind: "scanning" };
  let mounted: object | null = null;
  let active: { key: string; promise: Promise<boolean> } | null = null;
  const publish = (next: PairingState) => { state = next; for (const listener of listeners) listener(); };
  const retire = () => { epoch.retire(); active = null; };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    attach() {
      const token = {}; mounted = token;
      return () => { if (mounted === token) { mounted = null; retire(); } };
    },
    detect(link: PairingLink | null) { retire(); publish(link ? { kind: "detected", link } : { kind: "invalid" }); },
    accept(value: string) { this.detect(parsePairingLink(value)); },
    reset() { retire(); publish({ kind: "scanning" }); },
    async paste(read: () => Promise<string>, show: (value: string) => void) {
      if (!mounted || state.kind === "pairing" || state.kind === "paired") return;
      epoch.retire(); const signal = epoch.signal;
      let value: string;
      try { value = (await read()).trim(); } catch { return; }
      if (!mounted || signal.aborted || !value) return;
      show(value); this.accept(value);
    },
    pair(link: PairingLink): Promise<boolean> {
      const key = identity(link);
      if (active) return active.key === key ? active.promise : Promise.resolve(false);
      if (!mounted || (state.kind !== "detected" && state.kind !== "failed") || identity(state.link) !== key)
        return Promise.resolve(false);
      epoch.retire(); const signal = epoch.signal;
      const attempt = { key, promise: Promise.resolve(false) };
      const selected = { ...link, endpoints: [...link.endpoints] };
      attempt.promise = Promise.resolve().then(async () => {
        try {
          assertAuthActive(signal, "Pairing canceled");
          const backend = await effects.redeem(selected, signal);
          assertAuthActive(signal, "Pairing canceled");
          await effects.save(backend, signal);
          assertAuthActive(signal, "Pairing canceled");
          publish({ kind: "paired", link: selected });
          try { effects.complete(); } catch { console.warn("Could not open the paired backend"); }
          return true;
        } catch (error) {
          if (!signal.aborted && mounted) publish({ kind: "failed", link: selected, message: error instanceof Error ? error.message : "Pairing failed" });
          return false;
        } finally { if (active === attempt) active = null; }
      });
      active = attempt; publish({ kind: "pairing", link: selected });
      return attempt.promise;
    },
  };
}
