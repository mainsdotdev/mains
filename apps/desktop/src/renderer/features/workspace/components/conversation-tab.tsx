import { useBrowserPanel } from "@/hooks/use-browser-panel";
import type { ProviderVariant } from "@/lib/provider-variants";
import type { Run } from "../types";
import { BaseTab } from "./base-tab";
import { TabIcon } from "./run-tab";

/** The project sidebar owns switching and creation; the header holds one tab. */
export function ConversationTab({ title, run, variant, isActive, isFirst, onSelect, live }: {
  title: string;
  run?: Pick<Run, "id" | "status">;
  variant: ProviderVariant;
  isActive: boolean;
  isFirst?: boolean;
  onSelect: () => void;
  live?: boolean;
}) {
  const { isExpanded, toggleExpanded } = useBrowserPanel();
  const selected = isActive && !isExpanded;

  return <BaseTab isFirst={isFirst} isActive={selected} role="tab" ariaLabel={title} label={title} tooltip={title}
      icon={<TabIcon run={run ?? { status: "succeeded" }} variant={variant} isActive={selected} live={live} />}
      onClick={() => { onSelect(); if (isExpanded) toggleExpanded(); }} />;
}
