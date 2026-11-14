export const OPEN_ATLAS_BOOKMARK_EVENT = "mains:open-atlas-bookmark";

export interface AtlasBookmarkRequest {
  accountId: string;
  collectionId?: string;
}

export function openAtlasBookmark(request: AtlasBookmarkRequest): void {
  window.dispatchEvent(new CustomEvent(OPEN_ATLAS_BOOKMARK_EVENT, { detail: request }));
}
