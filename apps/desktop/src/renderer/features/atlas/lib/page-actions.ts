export type AtlasPageAction =
  | { type: "copy" | "import" | "history" | "trash" }
  | { type: "export"; format: "markdown" | "json" }
  | { type: "move"; collectionId: string | null };

export interface AtlasPageRequest {
  ownerKey: string;
  id: string;
  action?: AtlasPageAction;
}

export interface AtlasPendingPageAction extends AtlasPageRequest {
  token: string;
  action: AtlasPageAction;
}

const PAGE_REQUEST_EVENT = "mains:atlas-page-request";

/** The route owns switching Pages and their editor's unsaved content. */
export function requestAtlasPage(request: AtlasPageRequest) {
  window.dispatchEvent(new CustomEvent<AtlasPageRequest>(PAGE_REQUEST_EVENT, { detail: request }));
}

export function subscribeAtlasPageRequests(listener: (request: AtlasPageRequest) => void) {
  const receive = (event: Event) => listener((event as CustomEvent<AtlasPageRequest>).detail);
  window.addEventListener(PAGE_REQUEST_EVENT, receive);
  return () => window.removeEventListener(PAGE_REQUEST_EVENT, receive);
}
