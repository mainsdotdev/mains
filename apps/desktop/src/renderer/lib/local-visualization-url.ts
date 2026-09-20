const PASS_THROUGH = /^(mains-visualize:)/;
const CACHE_TTL_MS = 50 * 60 * 1000;

interface CachedUrl {
  url: string;
  signedAt: number;
}

const urlCache = new Map<string, CachedUrl>();
const inflight = new Map<string, Promise<string | null>>();

export function isPassThroughVisualizationSrc(src: string): boolean {
  return PASS_THROUGH.test(src);
}

export function getCachedSignedVisualizationUrl(
  absPath: string,
): string | undefined {
  const cached = urlCache.get(absPath);
  if (!cached) return undefined;
  if (Date.now() - cached.signedAt >= CACHE_TTL_MS) {
    urlCache.delete(absPath);
    return undefined;
  }
  return cached.url;
}

export async function signLocalVisualization(
  absPath: string,
): Promise<string | null> {
  if (!absPath) return null;
  const cached = getCachedSignedVisualizationUrl(absPath);
  if (cached) return cached;

  const existing = inflight.get(absPath);
  if (existing) return existing;

  const promise = window.api.visualizations
    .sign(absPath)
    .then(
      (
        response:
          | { success: true; data: string }
          | { success: false; error: string },
      ) => {
        if (!response.success) return null;
        urlCache.set(absPath, { url: response.data, signedAt: Date.now() });
        return response.data;
      },
    )
    .catch(() => null)
    .finally(() => {
      inflight.delete(absPath);
    });
  inflight.set(absPath, promise);
  return promise;
}
