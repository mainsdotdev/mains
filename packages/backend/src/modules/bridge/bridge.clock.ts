import type { BridgeHlc, BridgeHeader } from "@mains/contracts/bridge-protocol";

/** Pure wire ordering, shared by the client and the blind development hub. */
export function compareClock(a: BridgeHlc & { origin: string }, b: BridgeHlc & { origin: string }): number {
  return a.physicalMs - b.physicalMs || a.counter - b.counter || (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0);
}
export const headerClock = (header: BridgeHeader) => ({ ...header.hlc, origin: header.origin });
