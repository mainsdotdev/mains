import { useState, type ReactNode } from "react";
import type { AtlasLibraryEntry } from "@mains/contracts/atlas";
import { Button } from "@/components/ui";
import { Star } from "@/components/ui/icons/space";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { useAtlasFilePath } from "../hooks/use-atlas-file-path";
import { AtlasFileIcon } from "./atlas-file-icon";
import { AtlasPageIcon } from "./atlas-page-icon";
import { AtlasItemTags } from "./atlas-item-tags";

export function AtlasItemRow({ entry, menu, onOpen, onTag, onSource, sourceLabel }: {
  entry: AtlasLibraryEntry;
  menu: ReactNode;
  onOpen: () => void;
  onTag: (id: string) => void;
  onSource?: () => void;
  sourceLabel?: string;
}) {
  const bookmark = entry.kind === "bookmark";
  const image = entry.kind === "image";
  const coverId = entry.kind === "page" ? entry.saved?.metadata?.coverFileId : undefined;
  const path = useAtlasFilePath(entry.saved?.accountId,
    coverId ?? (image || bookmark && entry.saved?.metadata?.bookmark?.imageUrl ? entry.saved?.id : undefined),
    bookmark ? entry.saved?.bookmarkImagePath : image ? entry.path : null,
    image ? entry.generated : undefined);
  const local = useLocalImageUrl(path, 256, entry.date);
  const src = local ?? (bookmark ? proxiedImageSrc(entry.saved?.metadata?.bookmark?.imageUrl) : undefined);
  const [failed, setFailed] = useState<string>();
  let label = sourceLabel ?? (entry.kind === "page" ? "Page" : image ? "Image" : "Document");
  if (bookmark) {
    label = entry.saved?.metadata?.bookmark?.siteName ?? "Bookmark";
    try { label = new URL(entry.saved?.url ?? "").hostname.replace(/^www\./, ""); } catch { /* Legacy bookmark. */ }
  }
  const date = entry.saved?.createdAt ?? entry.date;
  const savedAt = new Date(date);
  const dateLabel = Number.isNaN(savedAt.getTime()) ? null : savedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const organizing = bookmark && (entry.saved?.bookmarkState?.status === "pending" || entry.saved?.bookmarkState?.status === "running");
  const status = organizing ? "Organizing…" : entry.saved?.bookmarkState?.error ? "Details incomplete" : null;
  return (
    <article className="group relative min-h-20 min-w-0 border-b border-primary-200/50 py-2.5 pl-21 pr-12 transition-colors hover:bg-primary-100/50 focus-within:bg-primary-100/50 dark:border-primary-800/70 dark:hover:bg-primary-900/50 dark:focus-within:bg-primary-900/50 sm:pl-22">
      <Button aria-label={bookmark ? `Open ${entry.title}` : entry.title} onClick={onOpen}
        className="block w-full text-left focus-visible:ring-2 focus-visible:ring-accent/40">
        <span aria-hidden="true" className="absolute left-3 top-1/2 flex h-11 w-14 -translate-y-1/2 items-center justify-center overflow-hidden rounded-md bg-primary-100/70 text-accent dark:bg-primary-900/70 sm:h-12 sm:w-16">
          {src && src !== failed ? (
            <>
              <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} className="size-full object-cover" />
              {entry.kind === "page" && <>
                <span className="absolute inset-0 bg-primary-950/10" />
                <span className="absolute left-1/2 top-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg bg-primary/85 shadow-sm ring-1 ring-primary-950/5 backdrop-blur-md dark:bg-primary-950/80 dark:ring-primary/10">
                  <AtlasPageIcon icon={entry.saved?.metadata?.icon} className="size-5 text-xl text-accent" />
                </span>
              </>}
            </>
          ) : entry.kind === "page" ? (
            <AtlasPageIcon icon={entry.saved?.metadata?.icon} className="size-6" />
          ) : (
            <AtlasFileIcon kind={entry.kind} fileName={entry.saved?.fileName ?? entry.generated?.fileName ?? entry.title} path={entry.path} className="size-6" />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold leading-snug text-primary-900 dark:text-primary-100">
          <span className="truncate">{entry.title}</span>
          {entry.saved?.isFavorite && <Star filled className="size-3 shrink-0 text-primary-500" />}
        </span>
      </Button>
      <div className="min-h-5"><AtlasItemTags tags={entry.saved?.tags ?? []} onTag={onTag} /></div>
      <div className="flex min-w-0 items-center gap-1.5 pt-1 text-xs text-primary-500">
        {onSource && !bookmark ? (
          <Button onClick={onSource} className="min-w-0 truncate text-left hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40">{label}</Button>
        ) : <span className="min-w-0 truncate" title={label}>{label}</span>}
        {dateLabel && <><span aria-hidden="true">·</span><time dateTime={date} title={savedAt.toLocaleString()} className="shrink-0">{dateLabel}</time></>}
        {status && <><span aria-hidden="true">·</span><span role={organizing ? "status" : undefined} title={entry.saved?.bookmarkState?.error} className={`truncate ${organizing ? "shine-text" : ""}`}>{status}</span></>}
      </div>
      <div className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full">{menu}</div>
    </article>
  );
}
