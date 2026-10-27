// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  spaces: [
    { id: "custom", slug: "codex", isArchived: false, sortOrder: 0 },
    { id: "codex", slug: "renamed-agent", isArchived: false, sortOrder: 1 },
    { id: "claude", slug: "claude", isArchived: false, sortOrder: 2 },
  ],
  archive: vi.fn(() => ({ unwrap: async () => undefined })),
  unarchive: vi.fn(() => ({ unwrap: async () => undefined })),
  setActive: vi.fn(() => ({ unwrap: async () => undefined })),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/lib/redux/api", () => ({
  useGetSpacesQuery: () => ({ data: mocks.spaces }),
  useGetAppSettingsQuery: () => ({ data: { activeSpaceId: "claude" } }),
  useArchiveSpaceMutation: () => [mocks.archive],
  useUnarchiveSpaceMutation: () => [mocks.unarchive],
  useSetActiveSpaceMutation: () => [mocks.setActive],
}));

import { useAgentSpaces } from "./use-agent-spaces";

describe("seeded Space identity", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);
  it("keeps a renamed seeded Space and excludes a custom Space with its old slug", () => {
    const { result } = renderHook(() => useAgentSpaces());
    expect(result.current.agentSpaces.map((space) => space.id)).toEqual(["codex", "claude"]);
    expect(result.current.spacesById.get("codex")?.id).toBe("codex");
    expect(result.current.visibleAgentCount).toBe(2);
  });
  it("toggles the seeded id even when a duplicate slug arrives first", async () => {
    const { result } = renderHook(() => useAgentSpaces());
    await result.current.toggleAgent("codex");
    expect(mocks.archive).toHaveBeenCalledWith("codex");
    expect(mocks.archive).not.toHaveBeenCalledWith("custom");
  });
});
