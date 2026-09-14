import { useMemo } from "react";
import { useActiveSpace } from "./use-active-space";
import {
  PROVIDER_VARIANTS,
  getProviderVariantById,
  type ProviderVariantDescriptor,
} from "@/lib/provider-variants";

/**
 * Provider-variant descriptor for the active space (`space.providerId`).
 * The space picker is the only way to change providers — the `/code` route is
 * provider-agnostic. Spaces without a (valid) providerId fall back to claude.
 */
export function useSpaceProviderVariant(): ProviderVariantDescriptor {
  const { activeSpace } = useActiveSpace();
  const providerId = activeSpace?.providerId;
  return useMemo(() => {
    if (providerId) {
      const descriptor = getProviderVariantById(providerId);
      if (descriptor) return descriptor;
      // Writes are validated (space.validation.ts) and the column is enum'd,
      // so this only fires for data that predates validation — surface it
      // instead of masking it.
      console.warn(
        `Unknown space providerId "${providerId}" — falling back to claude`,
      );
    }
    return PROVIDER_VARIANTS.claude;
  }, [providerId]);
}
