import { useState, type ReactNode } from "react";
import type { AtlasItem } from "@mains/contracts/atlas";
import { Button, Text } from "@/components/ui";
import { Generate } from "@/components/ui/icons";
import { Bookmark } from "@/components/ui/icons/space";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { useAtlasFilePath } from "../hooks/use-atlas-file-path";

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
  const [failed, setFailed] = useState<string>();
  let domain = item.metadata?.bookmark?.siteName ?? "Bookmark";
  try {
    domain = new URL(item.url ?? "").hostname.replace(/^www\./, "");
  } catch {
    /* Old backend or malformed legacy URL. */
  }
  return (
    <article className="group relative min-w-0 overflow-hidden rounded-3xl glass-surface">
      <Button
        aria-label={`Open ${item.title}`}
        onClick={onOpen}
        className="block w-full text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <div className="flex aspect-video items-center justify-center overflow-hidden bg-primary-100/70 dark:bg-primary-900/70">
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
            <Bookmark className="size-9 text-primary-400" />
          )}
        </div>
        <div className="px-4 pb-2 pt-4">
          <span className="mb-2 flex items-center gap-1.5 text-xxs text-primary-500">
            <span className="truncate">{domain}</span>
            {item.metadata?.bookmark?.contentType && (
              <span className="ml-auto shrink-0 capitalize">
                {item.metadata.bookmark.contentType}
              </span>
            )}
          </span>
          <h2 className="line-clamp-2 text-s font-medium leading-relaxed text-primary-900 dark:text-primary-100">
            {item.title}
          </h2>
          {item.description && (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-primary-500">
              {item.description}
            </p>
          )}
        </div>
      </Button>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-4 pt-2">
        {(item.tags ?? []).slice(0, 5).map((tag) => (
          <Button
            key={tag.id}
            onClick={() => onTag(tag.id)}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary-100 px-1.5 py-0.5 text-xxs text-primary-600 hover:text-accent dark:bg-primary-800/60 dark:text-primary-400"
          >
            {tag.source === "ai" && (
              <Generate aria-label="AI tag" className="size-2.5 shrink-0" />
            )}
            <span className="truncate">{tag.name}</span>
          </Button>
        ))}
        {item.bookmarkState?.status === "pending" ||
        item.bookmarkState?.status === "running" ? (
          <Text size="xs" tone="subtle" role="status">
            Organizing…
          </Text>
        ) : null}
        {item.bookmarkState?.error && (
          <span
            className="text-xxs text-primary-500"
            title={item.bookmarkState.error}
          >
            Details incomplete
          </span>
        )}
      </div>
      <div className="absolute right-3 top-3 rounded-full glass-surface opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {menu}
      </div>
    </article>
  );
}
