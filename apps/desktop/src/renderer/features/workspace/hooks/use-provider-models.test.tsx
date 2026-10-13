// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useProviderModels } from "./use-provider-models";

const catalog = vi.hoisted(() => ({ models: [] as any[], fetching: false, error: undefined as unknown }));
vi.mock("@/lib/redux/hooks", () => ({ useAppDispatch: () => vi.fn(), useAppSelector: () => "" }));
vi.mock("@/lib/transport", () => ({ appEvents: { providers: { onModelsUpdated: () => vi.fn() } } }));
vi.mock("@/lib/redux/api/providersApi", () => ({
  useGetProviderModelsQuery: () => ({ data: catalog.models, isFetching: catalog.fetching, error: catalog.error, refetch: vi.fn() }),
  useGetProviderCommandsQuery: () => ({ data: [] }), useGetProviderSkillsQuery: () => ({ data: [] }),
  useGetProviderByIdQuery: () => ({ data: { config: {} } }),
}));

afterEach(cleanup);
beforeEach(() => {
  catalog.fetching = false; catalog.error = undefined;
  catalog.models = [
    { id: "a", displayName: "Model A", supportedEffortLevels: [], serviceTiers: [{ id: "fast", name: "Fast" }, { id: "ultrafast", name: "Ultrafast" }] },
    { id: "b", displayName: "Model B", supportedEffortLevels: [], serviceTiers: [] },
  ];
});

describe("Codex speed preferences", () => {
  it("stores the advertised Ultrafast id as a user choice", async () => {
    const change = vi.fn();
    const h = renderHook(() => useProviderModels("codex", "codex", "a", undefined, undefined, { serviceTier: "fast" }, change));
    await act(() => h.result.current.handleServiceTierChange("ultrafast"));
    expect(change).toHaveBeenCalledExactlyOnceWith({ serviceTier: "ultrafast" }, "user");
    await act(() => h.result.current.handleServiceTierChange("invented-tier"));
    expect(change).toHaveBeenCalledOnce();
  });

  it("corrects an unsupported tier on model change without changing new-chat defaults", () => {
    const change = vi.fn();
    const h = renderHook(({ model }) => useProviderModels("codex", "codex", model, undefined, undefined,
      { serviceTier: "ultrafast" }, change), { initialProps: { model: "a" } });
    expect(h.result.current.serviceTier).toBe("ultrafast");
    expect(change).not.toHaveBeenCalled();
    h.rerender({ model: "b" });
    expect(change).toHaveBeenCalledExactlyOnceWith({ serviceTier: "default" }, "automatic");
  });

  it.each(["fetching", "error"])("keeps the stored tier while the catalog has an %s state", (state) => {
    catalog.fetching = state === "fetching"; catalog.error = state === "error" ? { message: "Offline" } : undefined;
    const change = vi.fn();
    renderHook(() => useProviderModels("codex", "codex", "b", undefined, undefined, { serviceTier: "ultrafast" }, change));
    expect(change).not.toHaveBeenCalled();
  });
});
