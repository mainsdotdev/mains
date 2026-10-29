import type { RunArtifactRow } from "@/db/schema";

/** A follow-up the agent offered after its answer (Claude, Codex). */
export interface PromptSuggestion {
  /** What goes into the composer. */
  prompt: string;
  /** The provider's short form for the chip, when it gave one. */
  label?: string;
}

type SuggestionSource = Pick<RunArtifactRow, "kind" | "content" | "metadataJson">;

/**
 * The follow-ups on offer, oldest first — the desktop's
 * `lastPromptSuggestionIndex`: the newest unbroken run of `prompt_suggestion`
 * artifacts, as long as no user prompt came after it. Later assistant output
 * does not consume an offer; the user's next message does.
 *
 * Takes artifacts newest first, the order the history window is read in.
 */
export function latestPromptSuggestions(newestFirst: readonly SuggestionSource[]): PromptSuggestion[] {
  const found: PromptSuggestion[] = [];
  for (const artifact of newestFirst) {
    if (artifact.kind === "prompt_suggestion") {
      if (artifact.content?.trim()) {
        const label = suggestionLabel(artifact.metadataJson);
        found.push({ prompt: artifact.content, ...(label ? { label } : {}) });
      }
      continue;
    }
    // Every other artifact ends a run of offers that has started; before
    // one has, only the user's own message rules the offer out.
    if (found.length > 0 || artifact.kind === "user-prompt") break;
  }
  return found.reverse();
}

function suggestionLabel(metadataJson: string | null): string | null {
  if (!metadataJson) return null;
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    const label = parsed && typeof parsed === "object" ? (parsed as { label?: unknown }).label : null;
    return typeof label === "string" && label.trim() ? label : null;
  } catch {
    return null;
  }
}
