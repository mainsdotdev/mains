import { lazy, Suspense } from "react";
import { Text } from "@/components/ui";
import { usePreviewPanel } from "@/hooks/use-preview-panel";

const PullRequestView = lazy(() => import("./pull-request-view").then((module) => ({ default: module.PullRequestView })));

export function PullRequestPreviewPanel() {
  const preview = usePreviewPanel();
  return preview.group.tabs.filter((tab) => tab.kind === "pull-request").map((tab) => {
    const active = preview.isOpen && preview.activeTab?.id === tab.id;
    return <div key={preview.ownerKey + ":" + tab.id} hidden={!active} inert={!active}
      className={active ? "absolute inset-0 flex min-h-0 flex-col" : "hidden"}>
      <Suspense fallback={<div role="status" className="flex justify-center py-12"><Text size="xs" className="shine-text">Loading pull request…</Text></div>}>
        <PullRequestView prRef={tab.prRef} url={tab.url} active={active} />
      </Suspense>
    </div>;
  });
}
