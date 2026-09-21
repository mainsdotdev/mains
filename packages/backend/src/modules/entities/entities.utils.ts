// ─────────────────────────────────────────────────────────────
// Entity Utils
// ─────────────────────────────────────────────────────────────
export function serializeLabels(labels?: string[]): string | null {
  if (!labels || labels.length === 0) return null;
  return JSON.stringify(labels);
}

export function serializeMetadata(
  metadata?: Record<string, unknown>
): string | null {
  if (!metadata) return null;
  return JSON.stringify(metadata);
}

export function parseLabels(labels: string | null): string[] {
  if (!labels) return [];
  try {
    return JSON.parse(labels);
  } catch {
    return [];
  }
}

export function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}
