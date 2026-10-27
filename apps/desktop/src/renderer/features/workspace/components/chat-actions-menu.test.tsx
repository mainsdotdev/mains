// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsMenu } from "./chat-actions-menu";

const state = vi.hoisted(() => ({ replica: false, mode: "chat" }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ mode: state.mode }) }));
vi.mock("@/hooks/use-suppress-browser-view", () => ({ useSuppressBrowserView: () => {} }));
vi.mock("@/lib/redux/hooks", () => ({
  useAppSelector: (select: (value: unknown) => unknown) => select({ workspace: { activeTab: "run-source" }, backends: { activeBackendId: "remote-connection-alias" } }),
}));
vi.mock("@/lib/redux/api", () => ({ useGetRunByIdQuery: () => ({ currentData: {
  id: "run-source", title: "Source conversation", goal: null, pinnedAt: null, ownerBackendId: "source-backend", isReplica: state.replica,
} }) }));
vi.mock("../hooks/use-chat-actions", () => ({ useChatActions: () => ({
  renameChat: vi.fn(), toggleChatPin: vi.fn(), forkChat: vi.fn(), copyLastMessage: vi.fn(), archiveChat: vi.fn(), deleteChat: vi.fn(),
}) }));
afterEach(() => { cleanup(); state.replica = false; state.mode = "chat"; });

describe("chat actions ownership", () => {
  it.each(["chat", "work"])("omits mutation controls for a synced %s conversation", (mode) => {
    state.mode = mode; state.replica = true;
    render(<ChatActionsMenu />);
    expect(screen.queryByRole("button", { name: "Chat options" })).toBeNull();
  });
  it("keeps source controls when the client uses a different connection alias", () => {
    render(<ChatActionsMenu />);
    expect(screen.getByRole("button", { name: "Chat options" })).toBeTruthy();
  });
});
