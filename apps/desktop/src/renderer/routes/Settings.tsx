import { Suspense } from "react";
import { useSearchParams } from "react-router-dom";
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
