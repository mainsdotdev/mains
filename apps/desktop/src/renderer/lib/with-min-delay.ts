/**
 * Await `work`, then pad the wait so the whole thing takes at least `minMs`.
 * Keeps quick async transitions from flashing their loading state. Rejections
 * propagate immediately — the padding only applies to the success path.
 */
export async function withMinDelay<T>(work: Promise<T>, minMs: number): Promise<T> {
  const start = Date.now();
  const result = await work;
  const remaining = Math.max(0, minMs - (Date.now() - start));
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  return result;
}
