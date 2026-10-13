function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Serialized result envelopes are distinct from a tool's ordinary JSON text. */
function envelope(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return record(value);
  try {
    const parsed = record(JSON.parse(value));
    return parsed &&
      (Array.isArray(parsed.content) ||
        typeof parsed.content === "string" ||
        parsed.structuredContent !== undefined ||
        parsed._meta !== undefined)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function mcpStructuredContentOmitted(value: unknown): boolean {
  return envelope(value)?.structuredContentOmitted === true;
}

function contentTexts(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    const item = record(block);
    if (item?.type === "text" && typeof item.text === "string")
      return item.text.trim() ? [item.text] : [];
    if (item?.type === "resource_link" && typeof item.uri === "string") {
      return [`${item.title ?? item.name ?? "Resource"}: ${item.uri}`];
    }
    return [];
  });
}

/** Render public content only. UI-only _meta never becomes visible JSON. */
export function mcpOutputSegments(value: unknown): string[] {
  const result = envelope(value);
  if (!result) return contentTexts(value);
  const segments = contentTexts(result.content);
  const structured = result.structuredContent;
  if (result.structuredContentOmitted !== true && structured !== undefined) {
    const nested = contentTexts(record(structured)?.content);
    if (nested.length) segments.push(...nested);
    else {
      try {
        const json = JSON.stringify(structured, null, 2);
        if (json) segments.push(json);
      } catch {
        // The remaining public text still renders for a non-serializable optional field.
      }
    }
  }
  if (Array.isArray(result.resourceLinks)) {
    segments.push(
      ...contentTexts(
        result.resourceLinks.map((link) => ({
          ...record(link),
          type: "resource_link",
        })),
      ),
    );
  }
  return segments;
}
