import { Suspense } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  getSettingsRouteId,
  getSettingsSection,
} from "@/features/settings/settings-sections";
import { SettingsPageShell } from "@/features/settings/components/settings-layout";
import { PageShell } from "@/components/layout/page-shell";

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  if (searchParams.get("section") === "bridge") {
    return <Navigate to="/bridge" replace />;
  }
  // Connections are hidden from Settings for now; /tasks owns them.
  if (searchParams.get("section") === "connections") {
    return <Navigate to="/tasks" replace />;
  }

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
