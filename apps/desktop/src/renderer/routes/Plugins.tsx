import { lazy, Suspense } from "react";
import { CircleSpinner, Heading3, Muted } from "@/components/ui";
import { PageShell } from "@/components/layout/page-shell";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import { useSearchParams } from "react-router-dom";
import { getProviderVariantById } from "@/lib/provider-variants";

const ProviderPlugins = lazy(() => import("@/features/settings/components/provider-plugins"));

export default function PluginsPage() {
  const spaceProvider = useSpaceProviderVariant();
  const [searchParams] = useSearchParams();
  const requestedProvider = searchParams.get("provider");
  const provider = (requestedProvider && getProviderVariantById(requestedProvider)) || spaceProvider;

  // Only drivers that implement the plugin API get the page (see supportsPlugins).
  const providerId = provider.supportsPlugins
    ? provider.providerId
    : undefined;

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <Heading3>Plugins</Heading3>
      </div>

      {providerId ? (
        <Suspense fallback={
          <div role="status" className="flex items-center gap-2 text-primary-500">
            <CircleSpinner className="size-4" />
            <Muted>Loading plugins…</Muted>
          </div>
        }>
          <ProviderPlugins providerId={providerId} />
        </Suspense>
      ) : (
        <Muted>Plugins aren&apos;t available for this agent yet.</Muted>
      )}
    </PageShell>
  );
}
