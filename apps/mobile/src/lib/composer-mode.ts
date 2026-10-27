import { isModeId, MODE_COMPOSER_CONTROLS } from "@mains/contracts/modes";

import { supportsGoalMode, supportsPlanToggle } from "./models";

/** Existing conversations retain their mode even when the selected space changes. */
export function composerModeControls({ providerId, runId, runMode, draftMode }: {
  providerId: string;
  runId?: string | null;
  runMode?: string | null;
  draftMode?: string | null;
}) {
  const candidate = runId ? runMode : draftMode;
  const mode = isModeId(candidate) ? candidate : null;
  const controls = mode ? MODE_COMPOSER_CONTROLS[mode] : null;
  return {
    mode,
    showPermissionControls: controls?.showPermissionControls ?? false,
    supportsPlanMode: Boolean(controls?.showPlanControls && supportsPlanToggle(providerId)),
    supportsGoalMode: Boolean(controls?.showGoalControls && supportsGoalMode(providerId)),
  };
}
