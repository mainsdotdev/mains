import { useState } from "react";

import { backendSession } from "@/backend/backend-session";
import type { UpdateRunSettingsPayload } from "@mains/contracts/runs";

/**
 * Changing a provider's run settings on the Mac from a sheet: the patch shows
 * at once as `pending` while the round trip is out, then clears — the synced
 * value has landed by then — and a refusal comes back as a `hint` to show.
 */
export function useRunSettings(providerId: string): {
  pending: UpdateRunSettingsPayload;
  hint: string | null;
  apply: (patch: UpdateRunSettingsPayload) => Promise<void>;
} {
  const [pending, setPending] = useState<UpdateRunSettingsPayload>({});
  const [hint, setHint] = useState<string | null>(null);

  const apply = async (patch: UpdateRunSettingsPayload) => {
    setPending((current) => ({ ...current, ...patch }));
    setHint(null);
    const result = await backendSession.updateRunSettings(providerId, patch);
    setPending((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch) as (keyof UpdateRunSettingsPayload)[]) delete next[key];
      return next;
    });
    if (!result.success) setHint(result.error);
  };

  return { pending, hint, apply };
}
