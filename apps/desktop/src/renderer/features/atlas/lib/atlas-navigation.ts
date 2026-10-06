import type { AtlasKind } from "@mains/contracts/atlas";

export type AtlasType = "all" | AtlasKind;
export type AtlasScope = "all" | "generated" | "saved" | "favorites";

export const ATLAS_TYPES = [
  { value: "all", label: "All" },
  { value: "page", label: "Pages" },
  { value: "file", label: "Docs" },
  { value: "image", label: "Images" },
] as const;

export function atlasView(params: URLSearchParams) {
  const rawType = params.get("type");
  const rawScope = params.get("view");
  return {
    type: (ATLAS_TYPES.some((item) => item.value === rawType) ? rawType : "all") as AtlasType,
    scope: (["generated", "saved", "favorites"].includes(rawScope ?? "") ? rawScope : "all") as AtlasScope,
    collectionId: params.get("project") ?? "",
    query: params.get("q") ?? "",
  };
}

export function atlasLibraryHref(type: AtlasType = "all", scope: AtlasScope = "all", collectionId = "") {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (scope !== "all") params.set("view", scope);
  if (collectionId) params.set("project", collectionId);
  return `/atlas${params.size ? `?${params}` : ""}`;
}

export function atlasImageCreatorHref(collectionId = "", runId?: string) {
  const path = runId ? `/atlas/images/runs/${encodeURIComponent(runId)}` : "/atlas/images/new";
  return collectionId ? `${path}?${new URLSearchParams({ project: collectionId })}` : path;
}
