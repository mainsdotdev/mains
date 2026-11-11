import { useMemo, useState, type ReactNode } from "react";
import type { AtlasListItem } from "@mains/contracts/atlas";
import { Button, Text } from "@/components/ui";
import { Picture } from "@/components/ui/icons";
import { Star } from "@/components/ui/icons/space";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { useAtlasFilePath } from "../hooks/use-atlas-file-path";
import { pagePreviewRows } from "../lib/page-preview";
import { AtlasPageIcon } from "./atlas-page-icon";
import { AtlasItemTags } from "./atlas-item-tags";

export function AtlasPageCard({ item, activity, menu, imagePaths, onOpen, onTag, fitContent = false }: {
  item: AtlasListItem;
  activity: string;
  menu: ReactNode;
  imagePaths: ReadonlyMap<string, string>;
  onOpen: () => void;
  onTag: (id: string) => void;
  fitContent?: boolean;
}) {
  const rows = useMemo(() => pagePreviewRows(item.preview ?? ""), [item.preview]);
  const imageIndex = rows.findIndex((row) => row.kind === "image" && row.url && imagePaths.has(row.url));
  const imageUrl = rows[imageIndex]?.url;
  const imagePath = imageUrl ? imagePaths.get(imageUrl) : undefined;
  const src = useLocalImageUrl(imagePath, 768);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const coverPath = useAtlasFilePath(item.accountId, item.metadata?.coverFileId);
  const coverSrc = useLocalImageUrl(coverPath, 768, item.updatedAt);
  const [failedCover, setFailedCover] = useState<string>();
  const showCover = !!coverSrc && coverSrc !== failedCover;
  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl glass-card">
      <div className="flex h-11 shrink-0 items-center gap-2 bg-primary-950/3 px-4 dark:bg-primary/3">
        <div className="min-w-0 flex-1">
          <Button onClick={onOpen} className="flex w-full min-w-0 items-center gap-2.5 text-left focus-visible:ring-2 focus-visible:ring-accent/40">
            <AtlasPageIcon icon={item.metadata?.icon} className="size-4 shrink-0 text-accent" />
            <Text as="span" size="s" className="truncate">{item.title}</Text>
          </Button>
          <AtlasItemTags tags={item.tags ?? []} onTag={onTag} compact className="pl-6.5" />
        </div>
        <Text as="span" size="xxs" tone="faint" title={new Date(item.updatedAt).toLocaleString()} className="shrink-0 whitespace-nowrap">{activity}</Text>
        {menu}
      </div>
      <div className="relative">
        <Button
          aria-label={`Open ${item.title}`}
          onClick={onOpen}
          className={`relative block w-full overflow-hidden p-4 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${fitContent && rows.length ? "min-h-24 max-h-64" : "aspect-4/3 max-h-64"}`}
        >
          {showCover && <>
            <img src={coverSrc} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setFailedCover(coverSrc)} className="pointer-events-none absolute inset-0 size-full object-cover" />
            <span aria-hidden="true" className={`pointer-events-none absolute inset-0 ${rows.length ? "bg-primary/80 dark:bg-primary-950/75" : "bg-primary-950/15"}`} />
          </>}
          {rows.length ? (
            <span aria-hidden="true" className={`pointer-events-none block overflow-hidden text-xxs leading-relaxed text-primary-800 dark:text-primary-200 ${fitContent ? "relative" : "absolute inset-4"}`}>
              {rows.map((row, index) => (
                <span key={index} style={row.depth ? { paddingLeft: row.depth * 10 } : undefined} className={`mb-1.5 block wrap-break-word ${
                  row.kind === "heading" ? `mt-3 font-semibold first:mt-0 ${row.level === 1 ? "text-sm" : "text-xs"}`
                    : row.kind === "quote" ? "border-l-2 border-primary-400/40 pl-2 italic"
                      : row.kind === "code" ? "font-mono text-t"
                        : ""
                }`}>
                  {row.kind === "image" && index === imageIndex && src && failedSrc !== src ? (
                    <img src={src} alt={row.text} loading="lazy" decoding="async" onError={() => setFailedSrc(src)} className="max-h-28 w-full rounded-lg object-contain" />
                  ) : row.kind === "check" || row.kind === "bullet" || row.kind === "numbered" || row.kind === "image" ? (
                    <span className="flex items-start gap-1.5">
                      {row.kind === "check" ? (
                        <span className={`mt-0.5 flex size-2.5 shrink-0 items-center justify-center rounded-xs border border-primary-400/70 text-t leading-none ${row.checked ? "bg-primary-400/20" : ""}`}>{row.checked ? "✓" : ""}</span>
                      ) : row.kind === "image" ? <Picture className="mt-0.5 size-3 shrink-0 text-primary-500" />
                        : <span className="shrink-0 text-primary-500">{row.marker ?? "•"}</span>}
                      <span className={row.checked ? "text-primary-500 line-through" : ""}>{row.text}</span>
                    </span>
                  ) : row.text}
                </span>
              ))}
            </span>
          ) : (
            <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
              <AtlasPageIcon icon={item.metadata?.icon} className="size-9 text-4xl text-accent/70" />
            </span>
          )}
        </Button>
        {item.isFavorite && (
          <span className="pointer-events-none absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-primary/85 shadow-sm ring-1 ring-primary-950/5 backdrop-blur-md dark:bg-primary-950/80 dark:ring-primary/10">
            <Star filled role="img" aria-label="Favorite" className="size-3.5 text-accent" />
          </span>
        )}
      </div>
    </article>
  );
}
