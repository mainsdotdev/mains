import { useState } from "react";
import { Web } from "@/components/ui/icons";
import { proxiedImageSrc } from "@/lib/proxied-image-src";

interface BrowserFaviconProps {
  faviconUrl: string | null;
  className?: string;
}

export function BrowserFavicon({
  faviconUrl,
  className = "size-4",
}: BrowserFaviconProps) {
  const src = proxiedImageSrc(faviconUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        onError={() => setFailedSrc(src)}
        className={`${className} rounded-[3px] object-contain`}
      />
    );
  }

  return (
    <Web
      aria-hidden="true"
      className={`${className} text-primary-400 dark:text-primary-500`}
    />
  );
}
