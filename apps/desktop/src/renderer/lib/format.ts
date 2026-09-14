/** Milliseconds → "Xs" / "Xm Ys" / "Xh Ym Zs". Null-tolerant for table cells. */
export function formatDurationMs(ms: number | null): string {
  if (ms == null) return "";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${seconds}s`;
}

/** Fixed 3-decimal dollar amount; empty string for null/zero (table cells). */
export function formatCostUSD(usd: number | null): string {
  if (usd === null || usd === 0) return "";
  return `$${usd.toFixed(3)}`;
}

/** Adaptive dollar amount from micro-USD: 4 decimals under a cent, else 2. */
export function formatCostFromMicros(micros: number): string {
  const usd = micros / 1_000_000;
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** Display label for a reasoning-effort level ("xhigh" → "Extra High"). */
export function formatEffortLevel(level: string): string {
  if (level === "ultracode") return "Ultracode";
  return level === "xhigh" ? "Extra High" : level;
}
