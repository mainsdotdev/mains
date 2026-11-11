import type { AtlasItemTag } from "@mains/contracts/atlas";
import { Button } from "@/components/ui";

/** Tags wrap by default; compact card headers keep them in one scrollable line. */
export function AtlasItemTags({ tags, onTag, className = "", compact = false }: {
  tags: AtlasItemTag[];
  onTag: (id: string) => void;
  className?: string;
  compact?: boolean;
}) {
  if (!tags.length) return null;
  return (
    <div role="group" aria-label="Tags" className={`flex min-w-0 items-baseline ${compact ? "noscrollbar flex-nowrap gap-x-1.5 overflow-x-auto text-xxs leading-4" : "flex-wrap gap-x-2 text-s leading-relaxed"} ${className}`}>
      {tags.map((tag) => (
        <Button key={tag.id} onClick={() => onTag(tag.id)} className={`rounded-sm text-left text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/40 ${compact ? "shrink-0 whitespace-nowrap leading-4" : "max-w-full leading-relaxed [overflow-wrap:anywhere]"}`}>
          #{tag.name}
        </Button>
      ))}
    </div>
  );
}
