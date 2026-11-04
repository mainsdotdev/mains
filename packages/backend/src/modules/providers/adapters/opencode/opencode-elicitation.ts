import { validateElicitationContent, type ElicitationContent } from "../../../../../shared/mcp-elicitation";

/** ACP result for `elicitation/create`. Decline and cancel omit `content`. */
export interface OpenCodeFormDecision {
  action: "accept" | "decline" | "cancel";
  content?: ElicitationContent;
}

export interface OpenCodeFormRequest {
  message: string;
  schema: Record<string, unknown>;
}

/** OpenCode only asks through a form-mode elicitation. URL mode is refused. */
export function openCodeFormRequest(params: unknown): OpenCodeFormRequest | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const body = params as Record<string, unknown>;
  if (body.mode !== "form") return null;
  const schema = body.requestedSchema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const message = typeof body.message === "string" && body.message.trim()
    ? body.message
    : "OpenCode";
  return { message, schema: schema as Record<string, unknown> };
}

/**
 * Map a settled approval card onto the ACP form result. OpenCode treats any
 * result other than `action: "accept"` plus schema-valid content as a cancel,
 * so a decline stays a decline and a broken answer is not sent as content.
 */
export function decideOpenCodeForm(
  schema: Record<string, unknown>,
  approval: { approved: boolean; answer?: string },
): OpenCodeFormDecision {
  if (approval.answer === "cancel") return { action: "cancel" };
  if (!approval.approved) return { action: "decline" };
  let parsed: unknown;
  try {
    parsed = approval.answer ? JSON.parse(approval.answer) : undefined;
  } catch {
    return { action: "decline" };
  }
  const validation = validateElicitationContent(schema, parsed);
  if (!validation.ok) return { action: "decline" };
  return { action: "accept", content: validation.content };
}
