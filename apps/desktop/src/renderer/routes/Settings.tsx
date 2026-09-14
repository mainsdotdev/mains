import { Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import {
  getSettingsRouteId,
  getSettingsSection,
} from "@/features/settings/settings-sections";
import { SettingsPageShell } from "@/features/settings/components/settings-layout";
import { PageShell } from "@/components/layout/page-shell";

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const activeSection = getSettingsRouteId(searchParams.get("section"));
  const section = getSettingsSection(activeSection);
  const { Component } = section;

  const { close: closeBrowserPanel } = useBrowserPanel();

  useEffect(() => {
    closeBrowserPanel();
  }, [closeBrowserPanel]);

  return (
    <PageShell>
      <Suspense
        key={section.id}
        fallback={<SettingsPageShell title={section.label} isLoading />}
      >
        <Component />
      </Suspense>
    </PageShell>
  );
}
