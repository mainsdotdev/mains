import { useEffect } from "react";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import ProviderPlugins from "@/features/settings/components/provider-plugins";
import { Heading3, Muted } from "@/components/ui";
import { PageShell } from "@/components/layout/page-shell";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";

export default function PluginsPage() {
  const { close: closeBrowserPanel } = useBrowserPanel();
  const spaceProvider = useSpaceProviderVariant();

  useEffect(() => {
    closeBrowserPanel();
  }, [closeBrowserPanel]);

  // Only drivers that implement the plugin API get the page (see supportsPlugins).
  const providerId = spaceProvider.supportsPlugins
    ? spaceProvider.providerId
    : undefined;

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <Heading3>Plugins</Heading3>
      </div>

      {providerId ? (
        <ProviderPlugins providerId={providerId} />
      ) : (
        <Muted>Plugins aren&apos;t available for this agent yet.</Muted>
      )}
    </PageShell>
  );
}
