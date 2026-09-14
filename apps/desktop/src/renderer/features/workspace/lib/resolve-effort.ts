import { pickDefaultEffort } from "@/lib/provider-variants";

/**
 * The effort level to persist, or null to leave the stored value alone.
 * An empty `effortLevel` means "clear it" — reasoning off.
 */
export type EffortResolution = { effortLevel: string } | null;

export interface ResolveEffortInput {
  /** Levels the selected model advertises; empty/undefined means none. */
  supportedEffortLevels: readonly string[] | undefined;
  /** Currently stored level ("" when none, "ultracode" when folded). */
  effortLevel: string;
  /** Claude's ultracode flag — implies xhigh plus workflow orchestration. */
  ultracode: boolean;
  /**
   * The user has explicitly turned reasoning off, as opposed to never having
   * chosen anything. Read from the raw stored `thinkingMode` flag: absence of
   * a level cannot carry this by itself, which is exactly what made "Off"
   * unselectable — the seed below could not tell the two states apart and
   * wrote the default straight back.
   */
  thinkingDisabled: boolean;
  /** The variant's preferred level, clamped to what the model offers. */
  effortDefault: string;
}

/**
 * Decide what the effort selection should become for a (model, stored effort)
 * pair. Pure so the clamp rules are testable without a React tree; the hook
 * only diffs the result against what is stored and writes when they differ.
 */
export function resolveEffortSelection(
  input: ResolveEffortInput,
): EffortResolution {
  const {
    supportedEffortLevels: supported,
    effortLevel,
    ultracode,
    thinkingDisabled,
    effortDefault,
  } = input;
  const hasLevels = !!supported && supported.length > 0;
  const supportsXhigh = !!supported?.includes("xhigh");

  // ultracode is on but the newly-selected model can't do xhigh — disable it
  // and fall back to the highest supported level (or Off if none). This is
  // what enforces "ultracode must not work on unsupported models".
  if (ultracode && !supportsXhigh) {
    return { effortLevel: hasLevels ? supported![supported!.length - 1] : "" };
  }
  // ultracode is on and the model still supports xhigh — leave it alone, or
  // the folded "ultracode" string gets clamped away on every render.
  if (ultracode) return null;

  // Model has no effort levels — clear whatever is stored.
  if (!hasLevels) return effortLevel ? { effortLevel: "" } : null;

  if (!effortLevel) {
    // Nothing stored. Seed the variant's default so a run never goes out with
    // the dropdown blank — unless the user put it there by turning reasoning
    // off, in which case seeding would silently undo their choice.
    return thinkingDisabled
      ? null
      : { effortLevel: pickDefaultEffort(supported, effortDefault) };
  }

  // Stored level the model doesn't offer — fall back to its highest.
  if (!supported!.includes(effortLevel)) {
    return { effortLevel: supported![supported!.length - 1] };
  }

  return null;
}
