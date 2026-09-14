import { capabilities, type Capabilities } from "./capabilities";

/**
 * Hook form of {@link capabilities}. Capabilities are static per session, so this
 * just returns the resolved record — but using a hook keeps call sites uniform
 * and leaves room for runtime-reactive capabilities later.
 */
export function useCapabilities(): Capabilities {
  return capabilities;
}
