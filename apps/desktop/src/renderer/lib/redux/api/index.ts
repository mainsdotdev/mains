/**
 * The renderer's RTK Query surface: every domain API in one import.
 *
 * Each `*Api.ts` file re-exports wholesale. The names are already namespaced by
 * convention (`useGetWorkspaceQuery`, `PrSearchInput`, …) and a check across all
 * 438 of them found no collisions, so listing them by hand only bought a second
 * place to forget an edit — and it had already drifted: eighteen `providersApi`
 * exports were missing here, which is why some callers deep-import that file.
 * Adding an endpoint is now one edit, in the file that owns it.
 *
 * `baseApi` stays explicit. It is the transport, not a domain surface, and its
 * internals (the IPC base query) are deliberately not public.
 */

export { baseApi } from "./baseApi";

export * from "./accountApi";
export * from "./appSettingsApi";
export * from "./automationsApi";
export * from "./collectionsApi";
export * from "./connectionsApi";
export * from "./entitiesApi";
export * from "./gitFlowApi";
export * from "./guardsApi";
export * from "./projectsApi";
export * from "./providersApi";
export * from "./pullRequestsApi";
export * from "./pulseApi";
export * from "./runsApi";
export * from "./shellApi";
export * from "./signalsApi";
export * from "./spaceApi";
export * from "./statsApi";
export * from "./syncApi";
export * from "./toolsApi";
export * from "./updatesApi";
export * from "./workspaceApi";
