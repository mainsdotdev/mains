import { useState } from "react";
import { CircleSpinner } from "@/components/ui";
import { Bookmark } from "@/components/ui/icons/space";

/** Keep the loading indicator until the preview's pixels are available. */
export function AtlasBookmarkPreview({ src, pending, imageClassName = "", iconClassName = "size-8" }: {
  src?: string;
  pending: boolean;
  imageClassName?: string;
  iconClassName?: string;
}) {
  const [loaded, setLoaded] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const hasImage = !!src && src !== failed;
  const loading = hasImage ? src !== loaded : !src && pending;
  return (
    <span aria-busy={loading} className="relative flex size-full items-center justify-center text-primary-400">
      {hasImage && (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
          className={`size-full object-cover transition-[opacity,transform] duration-200 motion-reduce:transition-none ${loading ? "opacity-0" : "opacity-100"} ${imageClassName}`}
        />
      )}
      {loading ? (
        <span role="status" className="absolute inset-0 flex items-center justify-center">
          <CircleSpinner className="size-5" />
          <span className="sr-only">Loading preview…</span>
        </span>
      ) : !hasImage && <Bookmark className={iconClassName} />}
    </span>
  );
}
