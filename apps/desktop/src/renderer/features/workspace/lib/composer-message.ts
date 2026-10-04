import { browserAnnotationPrompt } from "./browser-annotation";
import type { ContextItem } from "./composer-context";

/** Settings and ambient panel context are not a user-authored message. */
export function hasComposerMessage(text: string, attachmentCount: number, items: readonly ContextItem[]): boolean {
  return !!text.trim() || attachmentCount > 0 || items.some((item) => item.kind !== "mcp-app" || !item.hidden);
}

/** Comments can be submitted without a second, redundant instruction. */
export function composerAnnotationPrompt(items: readonly ContextItem[]): string {
  return [
    browserAnnotationPrompt(items),
    items.some((item) => item.kind === "review") ? "Address the attached review comments." : "",
  ].filter(Boolean).join("\n\n");
}
