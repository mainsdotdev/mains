// @vitest-environment jsdom

import { useState } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import { WorkspaceInput } from "./workspace-input";

const { space, plugin } = vi.hoisted(() => ({
  space: { id: "work-space", mode: "work", providerId: "codex" },
  plugin: { name: "demo-plugin", displayName: "Demo Plugin", scope: "plugin" },
}));

vi.mock("@/lib/redux/api", () => ({
  useGetAccountQuery: () => ({}),
  useGetAppSettingsQuery: () => ({ data: { activeSpaceId: space.id } }),
  useGetSpacesQuery: () => ({ data: [space] }),
  useGetProviderAccountInfoQuery: () => ({}),
  useListProjectIssuesQuery: () => ({}),
}));
vi.mock("@/lib/redux/api/assistantsApi", () => ({ useAssistantOverviewQuery: () => ({}) }));
vi.mock("@/lib/redux/api/shellApi", () => ({ useGetMentionableAppsQuery: () => ({}) }));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({
  useKeyboardShortcut: () => {},
  useKeyboardShortcutBinding: () => null,
}));
vi.mock("../hooks/use-context-usage", () => ({ useContextUsage: () => null }));
vi.mock("../hooks/use-open-file-in-editor", () => ({ useOpenFileInEditor: () => vi.fn() }));
vi.mock("../hooks/use-open-composer-mention", () => ({ useOpenComposerMention: () => vi.fn() }));
vi.mock("../hooks/use-realtime-voice", () => ({
  useRealtimeVoice: () => ({ state: { phase: "idle", runId: null, muted: false } }),
}));
vi.mock("../hooks/use-provider-models", () => ({
  useProviderModels: () => ({
    selectedModelDisplayName: "Test Model",
    modelDisplayNames: ["Test Model"],
    modelEffortLevelsByDisplayName: {},
    providerCommands: [],
    providerSkills: [plugin],
  }),
}));

function renderComposer() {
  const store = configureStore({ reducer: { workspace: workspaceReducer } });

  function Composer() {
    const [goal, setGoal] = useState("");
    return <WorkspaceInput goal={goal} onGoalChange={setGoal} onSubmit={() => {}}
      activeRun={undefined} isLoading={false} />;
  }

  render(<Provider store={store}><Composer /></Provider>);
  return { store, user: userEvent.setup(), editor: screen.getByRole("textbox") };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("Work composer plugin suggestions", () => {
  it.each(["@", "/"])("selects an installed plugin from the %s menu", async (trigger) => {
    const { store, user, editor } = renderComposer();

    expect(screen.queryByRole("button", { name: "Plugins" })).toBeNull();
    expect(screen.queryByRole("menu", { name: "Context suggestions" })).toBeNull();

    await user.type(editor, `${trigger}demo`);
    await user.click(screen.getByRole("menuitem", { name: /Demo Plugin/ }));

    expect(store.getState().workspace.contextItems).toEqual([
      expect.objectContaining({ kind: "skill", name: plugin.name, scope: "plugin" }),
    ]);
    expect(screen.queryByRole("menu", { name: "Context suggestions" })).toBeNull();
  });

  it.each(["$", "#"])("leaves suggestions closed when typing %s", async (trigger) => {
    const { user, editor } = renderComposer();

    await user.type(editor, `${trigger}demo`);

    expect(screen.queryByRole("menu", { name: "Context suggestions" })).toBeNull();
  });
});
