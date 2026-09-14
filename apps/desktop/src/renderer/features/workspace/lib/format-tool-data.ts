const MAX_DISPLAY_LENGTH = 200;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format tool input/output data for display.
 * Truncates long content and shows file paths nicely.
 */
export function formatToolData(data: unknown): string {
  if (!data) return "";

  let parsed: unknown = data;

  // Parse JSON string if needed
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch {
      if (data.length > MAX_DISPLAY_LENGTH) {
        return (
          data.substring(0, MAX_DISPLAY_LENGTH) + `... (${data.length} chars)`
        );
      }
      return data;
    }
  }

  // Handle object data
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;

    // Special handling for file content
    if (obj.content && typeof obj.content === "string") {
      const content = obj.content;
      const lines = content.split("\n").length;
      const bytes = content.length;

      if (obj.path && typeof obj.path === "string") {
        return `${obj.path} (${lines} lines, ${formatBytes(bytes)})`;
      }

      if (obj.detailedContent && typeof obj.detailedContent === "string") {
        const diffLines = obj.detailedContent.split("\n").length;
        return `File content (${lines} lines) with diff (${diffLines} lines)`;
      }

      if (content.length > MAX_DISPLAY_LENGTH) {
        const preview = content
          .substring(0, MAX_DISPLAY_LENGTH)
          .replace(/\n/g, " ");
        return `${preview}... (${lines} lines)`;
      }
    }

    // Special handling for file paths
    if (obj.path && typeof obj.path === "string") {
      const otherKeys = Object.keys(obj).filter(
        (k) => k !== "path" && k !== "content",
      );
      if (otherKeys.length === 0) {
        return obj.path;
      }
      return `${obj.path} ${JSON.stringify(Object.fromEntries(otherKeys.map((k) => [k, obj[k]])))}`;
    }

    // For other objects, show compact JSON
    const json = JSON.stringify(parsed);
    if (json.length > MAX_DISPLAY_LENGTH) {
      const keys = Object.keys(obj).slice(0, 5);
      return `{${keys.join(", ")}${keys.length < Object.keys(obj).length ? ", ..." : ""}} (${json.length} chars)`;
    }
    return json;
  }

  return String(parsed);
}
