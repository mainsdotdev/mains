import { HorizontalFadeScroller, Text, Tooltip } from "@/components/ui";
import type { ToolUsageItem } from "@mains/contracts/stats";
import { resolveTool } from "@/features/workspace/lib/resolve-tool";
import StatsPanel from "./stats-panel";

const LABELS = new Map(Object.entries({
  bash: "Terminal", shell: "Terminal", read: "Read files", write: "Write files", edit: "Edit files",
  glob: "Find files", grep: "Search code", imageview: "View images", websearch: "Web search",
  webfetch: "Web pages", checkpackage: "Packages", apply_patch: "Apply changes",
}));

export default function ToolUsageChart({ data }: { data: ToolUsageItem[] }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  return <StatsPanel title="Top tools" className="w-full min-w-0" action={<Text size="sm" tone="subtle">{total.toLocaleString()} calls</Text>}>
    {data.length === 0 ? <Text size="sm" tone="subtle" className="py-8 text-center">No tools used</Text>
      : <div role="list" aria-label="Most used tools">
        <HorizontalFadeScroller arrows arrowClassName="top-7" className="scroll-px-12"
          contentClassName="flex w-max items-start gap-4 p-1 pr-12">
        {data.map((item) => {
          const resolved = resolveTool(item.toolName);
          const label = LABELS.get(resolved.groupKey) ?? resolved.vendorLabel
            ?? resolved.displayName.replace(/([a-z\d])([A-Z])/g, "$1 $2");
          return <Tooltip key={item.toolName} content={`${resolved.displayName} · ${item.count.toLocaleString()} calls`}>
            <div role="listitem" tabIndex={0} aria-label={`${label}: ${item.count.toLocaleString()} calls`} title={item.toolName}
              className="w-22 shrink-0 snap-start flex flex-col items-center rounded-xl text-center focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2">
              <Text as="div" size="inherit" className="size-12 rounded-2xl glass-surface flex items-center justify-center [&_svg]:size-6">
                {resolved.icon}
              </Text>
              <Text as="div" size="xs" className="mt-2 min-h-8 w-full break-words leading-4">{label}</Text>
              <Text as="div" size="s" tone="muted" className="mt-1 tabular-nums">{item.count.toLocaleString()}</Text>
            </div>
          </Tooltip>;
        })}
        </HorizontalFadeScroller>
      </div>}
  </StatsPanel>;
}
