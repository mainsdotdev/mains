import { useState, type ReactNode } from "react";
import type { AtlasItem } from "@mains/contracts/atlas";
import { Button, Text } from "@/components/ui";
import { Bookmark } from "@/components/ui/icons/space";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { useAtlasFilePath } from "../hooks/use-atlas-file-path";
import { AtlasBookmarkTags } from "./atlas-bookmark-tags";

export function AtlasBookmarkCard({
  item,
  menu,
  onOpen,
  onTag,
  layout = "grid",
}: {
  item: AtlasItem;
  menu: ReactNode;
  onOpen: () => void;
  onTag: (id: string) => void;
  layout?: "grid" | "list";
}) {
  const list = layout === "list";
  const path = useAtlasFilePath(
    item.accountId,
    item.metadata?.bookmark?.imageUrl ? item.id : undefined,
    item.bookmarkImagePath ?? null,
  );
  const local = useLocalImageUrl(path, list ? 256 : 768, item.updatedAt);
  const src = local ?? proxiedImageSrc(item.metadata?.bookmark?.imageUrl);
  const [failed, setFailed] = useState<string>();
  const organizing = item.bookmarkState?.status === "pending" || item.bookmarkState?.status === "running";
  const status = organizing ? "Organizing…" : item.bookmarkState?.error ? "Details incomplete" : null;
  const savedAt = new Date(item.createdAt);
  const dateLabel = Number.isNaN(savedAt.getTime()) ? null : savedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  let domain = item.metadata?.bookmark?.siteName ?? "Bookmark";
  try {
    domain = new URL(item.url ?? "").hostname.replace(/^www\./, "");
  } catch {
    /* Old backend or malformed legacy URL. */
  }
  return (
    <article className={list
      ? "group relative min-h-24 min-w-0 border-b border-primary-200/50 py-4 pl-18 pr-10 transition-colors hover:bg-primary-100/50 focus-within:bg-primary-100/50 dark:border-primary-800/70 dark:hover:bg-primary-900/50 dark:focus-within:bg-primary-900/50 sm:pl-21.5"
      : "group relative flex min-w-0 flex-col overflow-hidden rounded-xl glass-surface"}>
      <Button
        aria-label={`Open ${item.title}`}
        onClick={onOpen}
        className="block w-full text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <div className={list
          ? "absolute left-0 top-4 flex h-12 w-14 items-center justify-center overflow-hidden rounded-md bg-primary-100/70 dark:bg-primary-900/70 sm:h-14 sm:w-17.5"
          : "flex aspect-[2.2/1] max-h-40 items-center justify-center overflow-hidden bg-primary-100/70 dark:bg-primary-900/70"}>
          {src && src !== failed ? (
            <img
              src={src}
              onError={() => setFailed(src)}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
            />
          ) : (
            <Bookmark className={`${list ? "size-6" : "size-9"} text-primary-400`} />
          )}
        </div>
        <div className={list ? "pb-1.5" : "px-4 pb-1.5 pt-3"}>
          <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-primary-900 dark:text-primary-100">
            {item.title}
          </h2>
          {!list && item.description && (
            <p className="mt-1.5 line-clamp-3 text-s leading-relaxed text-primary-600 dark:text-primary-300">
              {item.description}
            </p>
          )}
        </div>
      </Button>
      <AtlasBookmarkTags tags={item.tags ?? []} onTag={onTag} className={list ? "" : "px-4"} />
      {status && (
        <Text size="xs" tone="subtle" role={organizing ? "status" : undefined} className={list ? "pt-1.5" : "px-4 pt-1.5"} title={item.bookmarkState?.error}>
          {status}
        </Text>
      )}
      <div className={`flex min-w-0 items-center gap-1.5 text-xs text-primary-500 ${list ? "pt-1" : "mt-auto px-4 pb-4 pt-2"}`}>
        <span className="min-w-0 truncate" title={domain}>{domain}</span>
        {dateLabel && <>
          <span aria-hidden="true">·</span>
          <time dateTime={item.createdAt} title={savedAt.toLocaleString()} className="shrink-0">{dateLabel}</time>
        </>}
      </div>
      <div className={`absolute rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${list ? "right-0 top-1/2 -translate-y-1/2" : "right-3 top-3 glass-surface"}`}>
        {menu}
      </div>
    </article>
  );
}
