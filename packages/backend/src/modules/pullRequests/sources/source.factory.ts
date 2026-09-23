// ─────────────────────────────────────────────────────────────
// PR Source Factory
// Resolves a provider id to a live PrSource using the stored
// connection credentials. No instance cache: sources are cheap to
// construct and reading credentials per call means a token change
// is picked up immediately.
// ─────────────────────────────────────────────────────────────

import { getConnectionWithSecrets } from "../../connections";
import { createGithubPrSource } from "./github.source";
import type { PrSource } from "./source.types";

/** PR provider ids — extend when GitLab/Bitbucket sources land. */
export const SUPPORTED_PR_PROVIDERS = ["github"] as const;
export type SupportedPrProvider = (typeof SUPPORTED_PR_PROVIDERS)[number];

export function isSupportedPrProvider(
  provider: string,
): provider is SupportedPrProvider {
  return (SUPPORTED_PR_PROVIDERS as readonly string[]).includes(provider);
}

/** Create a source for the provider, or null when it isn't connected. */
export async function createPrSource(
  provider: SupportedPrProvider,
): Promise<PrSource | null> {
  const connection = await getConnectionWithSecrets(provider);
  if (!connection) return null;

  switch (provider) {
    case "github": {
      const token = connection.secrets.token;
      if (!token) return null;
      return createGithubPrSource({ token });
    }
    default:
      return null;
  }
}
