import type { AtlasItemTag } from "@mains/contracts/atlas";
import { Button } from "@/components/ui";

/** All tags wrap as themed hashtags in Atlas cards and lists. */
export function AtlasItemTags({ tags, onTag, className = "" }: {
  tags: AtlasItemTag[];
  onTag: (id: string) => void;
  className?: string;
}) {
  if (!tags.length) return null;
  return (
    <div role="group" aria-label="Tags" className={`flex min-w-0 flex-wrap items-baseline gap-x-2 text-s leading-relaxed ${className}`}>
      {tags.map((tag) => (
        <Button key={tag.id} onClick={() => onTag(tag.id)} className="max-w-full rounded-sm text-left leading-relaxed text-accent [overflow-wrap:anywhere] hover:underline focus-visible:ring-2 focus-visible:ring-accent/40">
          #{tag.name}
        </Button>
      ))}
    </div>
  );
}
