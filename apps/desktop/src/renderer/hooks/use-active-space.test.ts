// @vitest-environment jsdom

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Space } from "@/lib/redux/api/spaceApi";
import { ActiveSpaceOverrideProvider, useActiveSpace } from "./use-active-space";

const cached = vi.hoisted(() => ({
  settings: { activeSpaceId: "space-claude" },
}));

vi.mock("@/lib/redux/api", () => ({
  useGetAppSettingsQuery: () => ({ data: cached.settings, isLoading: false }),
  useGetSpacesQuery: () => ({ data: [], isLoading: false }),
}));

function space(id: string, providerId: Space["providerId"], mode: Space["mode"]): Space {
  return {
    id,
    accountId: "default",
    name: id,
    slug: id,
    description: null,
    systemPrompt: null,
    model: null,
    icon: null,
    themeConfig: null,
    providerId,
    mode,
    sortOrder: 0,
    isArchived: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function Probe() {
  const { activeSpaceId, activeSpace } = useActiveSpace();
  return createElement("output", { "data-testid": "space" },
    `${activeSpaceId}:${activeSpace?.providerId}:${activeSpace?.mode}`);
}

describe("active space in the browser chat renderer", () => {
  it("uses the parent window's space immediately after a switch despite a stale query cache", () => {
    const codex = space("space-codex", "codex", "developer");
    const claude = space("space-claude", "claude_code", "work");
    const view = render(createElement(ActiveSpaceOverrideProvider, { space: codex }, createElement(Probe)));
    expect(screen.getByTestId("space").textContent).toBe("space-codex:codex:developer");

    view.rerender(createElement(ActiveSpaceOverrideProvider, { space: claude }, createElement(Probe)));
    expect(screen.getByTestId("space").textContent).toBe("space-claude:claude_code:work");
  });
});
