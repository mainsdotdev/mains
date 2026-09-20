import { useEffect, useState } from "react";
import {
  getCachedSignedVisualizationUrl,
  isPassThroughVisualizationSrc,
  signLocalVisualization,
} from "@/lib/local-visualization-url";

export function useLocalVisualizationUrl(
  src: string | undefined | null,
): string | undefined {
  const sync = src ? resolveSync(src) : undefined;
  const [asyncEntry, setAsyncEntry] = useState<{
    src: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!src || sync !== undefined) return;
    let cancelled = false;
    void signLocalVisualization(src).then((next) => {
      if (!cancelled && next) setAsyncEntry({ src, url: next });
    });
    return () => {
      cancelled = true;
    };
  }, [src, sync]);

  if (sync !== undefined) return sync;
  if (asyncEntry && asyncEntry.src === src) return asyncEntry.url;
  return undefined;
}

function resolveSync(src: string): string | undefined {
  if (isPassThroughVisualizationSrc(src)) return src;
  return getCachedSignedVisualizationUrl(src);
}
