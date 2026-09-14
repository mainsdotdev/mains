/**
 * Tool outputs arrive either as structured objects or as that object JSON-
 * serialized into a string, depending on the provider adapter. Returns the
 * parsed value when the string is JSON, the original string when it isn't,
 * and null for empty output — so parsers can branch on shape, not encoding.
 */
export function coerceToolOutput(output: unknown): unknown {
  if (!output) return null;
  if (typeof output !== "string") return output;
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

/**
 * Recursively collect the text bodies out of a coerced tool result. Handles the
 * shapes the adapters actually emit: a bare string, an Anthropic-style content
 * block array (`[{ type: "text", text }]`), and an MCP envelope
 * (`{ content: [...] }`).
 */
function collectOutputText(value: unknown): string[] {
  if (typeof value === "string") return value.length > 0 ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectOutputText);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.content !== undefined) return collectOutputText(obj.content);
    if (typeof obj.text === "string") return [obj.text];
  }
  return [];
}

/**
 * Flatten a tool result into text a display can render. Falls back to a pretty
 * JSON dump when the payload carries no text blocks, so a structured result is
 * still shown rather than silently dropped. Returns "" for empty output.
 */
export function toolOutputText(output: unknown): string {
  const parsed = coerceToolOutput(output);
  if (parsed === null) return "";
  if (typeof parsed === "string") return parsed.trim();

  const text = collectOutputText(parsed).join("\n").trim();
  if (text.length > 0) return text;

  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return "";
  }
}

/**
 * Keys that usually carry the human-meaningful gist of a call, in priority
 * order. Checked before falling back to "first scalar param", so a tool we've
 * never seen still gets a useful one-line preview instead of "(6 params)".
 */
const PREVIEW_KEYS = [
  "description",
  "summary",
  "title",
  "name",
  "query",
  "prompt",
  "message",
  "command",
  "pattern",
  "file_path",
  "filePath",
  "path",
  "url",
  "id",
];

/** Params whose values are noise in a one-line preview. */
const PREVIEW_SKIP_KEYS = new Set(["type", "kind", "schema", "$schema"]);

function toOneLine(value: string, max = 80): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function scalarPreview(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .filter((v) => typeof v === "string" || typeof v === "number")
      .slice(0, 3)
      .join(", ");
  }
  return "";
}

/**
 * Best-effort one-line description of an arbitrary param object. Prefers a
 * well-known descriptive key; otherwise labels the first scalar with its key
 * name (`branch: main`) so the preview says *something* about the call. Returns
 * "" when every value is a nested object/empty.
 */
export function previewParams(
  params: Record<string, unknown> | null | undefined,
): string {
  if (!params) return "";

  for (const key of PREVIEW_KEYS) {
    const preview = scalarPreview(params[key]);
    if (preview) return toOneLine(preview);
  }

  for (const [key, value] of Object.entries(params)) {
    if (PREVIEW_SKIP_KEYS.has(key)) continue;
    const preview = scalarPreview(value);
    if (preview) return toOneLine(`${key}: ${preview}`);
  }

  return "";
}

export interface ParsedToolContent {
  toolName: string;
  params: Record<string, unknown> | null;
  summary: string;
}

export function parseToolContent(content: string): ParsedToolContent {
  const colonIdx = content.indexOf(":");
  if (colonIdx === -1) {
    return { toolName: content, params: null, summary: content };
  }

  const toolName = content.substring(0, colonIdx).trim();
  const rest = content.substring(colonIdx + 1).trim();

  try {
    const params = JSON.parse(rest);
    let summary = "";
    if (params.file_path) {
      summary = params.file_path.split("/").pop() || params.file_path;
    } else if (params.command) {
      summary =
        params.command.length > 100
          ? params.command.substring(0, 100) + "..."
          : params.command;
    } else if (params.description) {
      summary = params.description;
    } else if (params.skill) {
      summary = params.skill;
    } else {
      // Unregistered tool: derive something readable from whatever params it
      // has. Only fall back to the opaque "(N params)" when every value is a
      // nested object we can't preview.
      const preview = previewParams(params);
      const paramCount = Object.keys(params).length;
      summary = preview || (paramCount > 0 ? `(${paramCount} params)` : "");
    }
    return { toolName, params, summary };
  } catch {
    const summary = rest.length > 60 ? rest.substring(0, 60) + "..." : rest;
    return { toolName, params: null, summary };
  }
}
