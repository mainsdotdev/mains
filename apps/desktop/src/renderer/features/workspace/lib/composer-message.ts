import type { ContextItem } from "./composer-context";

/** Settings and ambient panel context are not a user-authored message. */
export function hasComposerMessage(text: string, attachmentCount: number, items: readonly ContextItem[]): boolean {
  return !!text.trim() || attachmentCount > 0 || items.some((item) => item.kind !== "mcp-app" || !item.hidden);
}
