import type { ReactNode } from "react";
import type { AtlasItem } from "@mains/contracts/atlas";
import { Button, Text } from "@/components/ui";
import { Star } from "@/components/ui/icons/space";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { useAtlasFilePath } from "../hooks/use-atlas-file-path";
import { AtlasItemTags } from "./atlas-item-tags";
import { AtlasBookmarkPreview } from "./atlas-bookmark-preview";

export function AtlasBookmarkCard({
  item,
  menu,
  onOpen,
  onTag,
}: {
  item: AtlasItem;
  menu: ReactNode;
  onOpen: () => void;
  onTag: (id: string) => void;
}) {
  const path = useAtlasFilePath(
    item.accountId,
    item.metadata?.bookmark?.imageUrl ? item.id : undefined,
    item.bookmarkImagePath ?? null,
  );
  const local = useLocalImageUrl(path, 768, item.updatedAt);
  const src = local ?? proxiedImageSrc(item.metadata?.bookmark?.imageUrl);
  const fetching = item.bookmarkState?.status === "pending" || item.bookmarkState?.status === "running";
  const status = fetching ? "Fetching details…" : item.bookmarkState?.error ? "Details incomplete" : null;
  const savedAt = new Date(item.createdAt);
  const dateLabel = Number.isNaN(savedAt.getTime()) ? null : savedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  let domain = item.metadata?.bookmark?.siteName ?? "Bookmark";
  try {
    domain = new URL(item.url ?? "").hostname.replace(/^www\./, "");
  } catch {
    /* Old backend or malformed legacy URL. */
  }
  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl glass-surface">
      <Button
        aria-label={`Open ${item.title}`}
        onClick={onOpen}
        className="block w-full text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <div className="flex aspect-[2.4/1] max-h-32 w-full items-center justify-center overflow-hidden bg-primary-200/40 dark:bg-primary-800/60">
          <AtlasBookmarkPreview src={src} pending={fetching} imageClassName="group-hover:scale-[1.02] motion-reduce:transform-none" />
        </div>
        <div className="px-4 pb-1.5 pt-3">
          <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-primary-900 dark:text-primary-100">
            {item.title}
          </h2>
          {item.description && (
            <p className="mt-1.5 line-clamp-2 text-s leading-relaxed text-primary-600 dark:text-primary-300">
              {item.description}
            </p>
          )}
        </div>
      </Button>
      <AtlasItemTags tags={item.tags ?? []} onTag={onTag} className="px-4" />
      {status && (
        <Text size="xs" tone="subtle" role={fetching ? "status" : undefined} className="px-4 pt-1.5" title={item.bookmarkState?.error}>
          <span className={fetching ? "shine-text" : undefined}>{status}</span>
        </Text>
      )}
      <div className={`mt-auto flex min-w-0 items-center gap-1.5 pb-3 pl-4 pt-2 text-xs text-primary-500 ${item.isFavorite ? "pr-10" : "pr-4"}`}>
        <span className="min-w-0 truncate" title={domain}>{domain}</span>
        {dateLabel && <>
          <span aria-hidden="true">·</span>
          <time dateTime={item.createdAt} title={savedAt.toLocaleString()} className="shrink-0">{dateLabel}</time>
        </>}
      </div>
      <div className="absolute right-3 top-3 rounded-full glass-surface opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {menu}
      </div>
      {item.isFavorite && <Star filled role="img" aria-label="Favorite" className="pointer-events-none absolute bottom-3 right-3 size-3.5 text-accent" />}
    </article>
  );
}
