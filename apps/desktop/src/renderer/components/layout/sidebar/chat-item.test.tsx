// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentRun } from "@/lib/redux/api";
import { ChatItem } from "./chat-item";

const run: RecentRun = {
  id: "chat-1",
  accountId: "account-1",
  workspaceId: null,
  collectionId: null,
  spaceId: "space-1",
  providerId: "codex",
  mode: "chat",
  model: null,
  title: "A full chat title",
  goal: null,
  status: "succeeded",
  systemPrompt: null,
  configSnapshot: null,
  toolPolicySnapshot: null,
  startedAt: null,
  endedAt: null,
  lastError: null,
  sessionId: null,
  isArchived: false,
  pinnedAt: null,
  createdAt: 1,
  updatedAt: Date.now() - 7 * 60_000,
};

let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function flushFrames() {
  act(() => {
    const pending = frames;
    frames = [];
    pending.forEach((callback) => callback(0));
  });
}
function setup() {
  const callbacks = {
    onSelect: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onTogglePin: vi.fn(),
  };
  render(
    <ChatItem
      run={run}
      variant="codex"
      isActive={false}
      isRecent
      isPinned={false}
      collections={[]}
      {...callbacks}
    />,
  );
  const row = screen.getByRole("button", { name: /^A full chat title/ });
  return { row, ...callbacks, user: userEvent.setup() };
}
function openCard(row: HTMLElement) {
  act(() => row.focus());
  fireEvent.keyDown(row, { key: "ArrowRight" });
  flushFrames();
  return screen.getByRole("dialog", { name: run.title! });
}

describe("ChatItem quick actions", () => {
  it("keeps the native browser behind the actions menu and its Move submenu until dismissal", async () => {
    const setVisible = vi.fn();
    vi.stubGlobal("api", { browser: { setVisible } });
    const { user } = setup();
    expect(setVisible).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Chat options" }));
    expect(setVisible).toHaveBeenCalledExactlyOnceWith(false);
    await user.click(screen.getByRole("menuitem", { name: "Move" }));
    const submenuItem = screen.getByRole("menuitemradio", { name: "No project" });
    fireEvent.keyDown(submenuItem, { key: "ArrowLeft" });
    expect(screen.getByRole("menu", { name: "Chat actions" })).toBeTruthy();
    expect(setVisible).toHaveBeenCalledExactlyOnceWith(false);

    fireEvent.keyDown(screen.getByRole("menu", { name: "Chat actions" }), { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Chat actions" })).toBeNull();
    expect(setVisible).toHaveBeenLastCalledWith(true);
  });

  it("opens the focused rename editor and keeps it focused through card cleanup", async () => {
    const { row, user, onRename, onSelect } = setup();
    const card = openCard(row);
    expect(within(card).getByLabelText("Last updated 7m")).toBeTruthy();
    await user.click(within(card).getByRole("button", { name: "Rename chat" }));
    flushFrames();
    const input = screen.getByRole("textbox", { name: "Chat title" });
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.clear(input);
    await user.type(input, "Renamed from the card{Enter}");
    expect(onRename).toHaveBeenCalledExactlyOnceWith("Renamed from the card");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each(["Pin chat", "Archive chat", "Delete chat"])(
    "runs %s without invoking the other row actions",
    async (label) => {
      const { row, user, onSelect, onArchive, onTogglePin, onDelete } = setup();
      const card = openCard(row);
      await user.click(within(card).getByRole("button", { name: label }));
      flushFrames();
      expect(onSelect).not.toHaveBeenCalled();
      expect(onArchive).toHaveBeenCalledTimes(label === "Archive chat" ? 1 : 0);
      expect(onTogglePin).toHaveBeenCalledTimes(label === "Pin chat" ? 1 : 0);
      expect(onDelete).toHaveBeenCalledTimes(label === "Delete chat" ? 1 : 0);
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("hides the hover card while the existing options menu is open", async () => {
    const { row, user, onSelect } = setup();
    openCard(row);
    const options = screen.getByRole("button", { name: "Chat options" });
    // The menu button's keyboard event must not select its containing row.
    fireEvent.keyDown(options, { key: "Enter" });
    await user.click(options);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("menu", { name: "Chat actions" })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
