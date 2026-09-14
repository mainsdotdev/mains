import { PatchDiff } from "@pierre/diffs/react";
import { Text } from "@/components/ui";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { DIFF_TYPOGRAPHY_STYLE, patchDiffOptions } from "@/lib/diff-style";
import { useDiffHighlighterReady } from "@/lib/diff-highlighter";

export default function ToolDiffBodyContent({ patch }: { patch: string }) {
  const isDarkMode = useIsDarkMode();
  const highlighterReady = useDiffHighlighterReady();

  return highlighterReady ? (
    <PatchDiff
      patch={patch}
      style={DIFF_TYPOGRAPHY_STYLE}
      options={patchDiffOptions(isDarkMode)}
    />
  ) : (
    <Text as="div" size="xs" tone="subtle" className="px-2 py-1.5 shine-text">
      Loading diff...
    </Text>
  );
}
