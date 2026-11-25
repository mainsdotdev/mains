// @vitest-environment jsdom

import { createElement, createRef } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedContextDropdown } from "./unified-context-dropdown";
import type { SkillInfo } from "@/lib/redux/api/providersApi";
import type { Assistant, AssistantOverview, AssistantWelcome } from "@mains/contracts/assistants";

const getMentionableApps = vi.hoisted(() => vi.fn());

vi.mock("@/lib/redux/api/shellApi", () => ({
  useGetMentionableAppsQuery: getMentionableApps,
}));

vi.mock("@/lib/redux/api", () => ({
  useListProjectIssuesQuery: () => ({ data: [], isLoading: false }),
}));

const directory = {
  name: "components",
  fullPath: "/repo/src/components",
  type: "directory" as const,
  hasChildren: true,
};

function renderDropdown(overrides: { filterText?: string; providerId?: string; workspacePath?: string; skills?: SkillInfo[]; isLoadingSkills?: boolean; assistantOverview?: Pick<AssistantOverview, "assistants" | "welcomes"> } = {}) {
  const onSelectFile = vi.fn();
  const onSelectSkill = vi.fn();
  const onSelectAssistant = vi.fn();
  const onNavigateFile = vi.fn();
  const onClose = vi.fn();

  render(
    createElement(UnifiedContextDropdown, {
      isOpen: true,
      trigger: "@",
      providerId: overrides.providerId,
      filterText: overrides.filterText ?? "",
      workspacePath: overrides.workspacePath ?? "/repo",
      commands: [],
      skills: overrides.skills ?? [],
      assistantOverview: overrides.assistantOverview,
      onSelectAssistant,
      isLoadingSkills: overrides.isLoadingSkills,
      onSelectCommand: vi.fn(),
      onSelectSkill,
      onSelectFile,
      onNavigateFile,
      onSelectIssue: vi.fn(),
      onClose,
      dropdownRef: createRef<HTMLDivElement>(),
    }),
  );

  return { onSelectFile, onSelectSkill, onSelectAssistant, onNavigateFile, onClose };
}

beforeEach(() => {
  getMentionableApps.mockReset();
  getMentionableApps.mockReturnValue({ currentData: [], isFetching: false });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("UnifiedContextDropdown Mac app mentions", () => {
  it("offers installed apps with a Computer use badge for Codex and selects their context", async () => {
    getMentionableApps.mockReturnValue({
      currentData: [{ bundleId: "com.raycast.macos", name: "Raycast", icon: null }],
      isFetching: false,
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { fileExplorer: { listDir: vi.fn(), searchFiles: vi.fn().mockResolvedValue({ success: true, data: [] }) } },
    });
    const { onSelectSkill } = renderDropdown({ filterText: "raycast", providerId: "codex" });

    const row = screen.getByRole("menuitem", { name: /Raycast.*Computer use/ });
    await userEvent.setup().click(row);

    expect(onSelectSkill).toHaveBeenCalledWith(expect.objectContaining({
      name: "mac-app:com.raycast.macos",
      displayName: "Raycast",
      scope: "computer",
    }));
    expect(getMentionableApps).toHaveBeenCalledWith("raycast", { skip: false });
  });

  it("does not offer computer-use apps for other providers", () => {
    getMentionableApps.mockReturnValue({
      currentData: [{ bundleId: "com.raycast.macos", name: "Raycast", icon: null }],
      isFetching: false,
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { fileExplorer: { listDir: vi.fn(), searchFiles: vi.fn().mockResolvedValue({ success: true, data: [] }) } },
    });
    renderDropdown({ filterText: "raycast", providerId: "claude_code" });

    expect(screen.queryByText("Computer use")).toBeNull();
    expect(getMentionableApps).toHaveBeenCalledWith("raycast", { skip: true });
  });
});

describe("UnifiedContextDropdown assistant calls", () => {
  it("offers ready and legacy mates by responsibility and selects their exact identity by keyboard", async () => {
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { fileExplorer: { listDir: vi.fn(), searchFiles: vi.fn().mockResolvedValue({ success: true, data: [] }) } },
    });
    const assistant: Assistant = {
      id: "testflight", accountId: "default", teamId: "team", name: "Beta checker", description: "TestFlight release checks", instructions: "Verify builds",
      providerId: "codex", spaceId: "codex", model: "model", effort: "high", isArchived: false, avatar: { shape: "cube", color: "mint" },
      conversationSettings: { model: "model", config: {} }, spaceSnapshot: { id: "codex", accountId: "default", name: "Codex", providerId: "codex", mode: "developer", systemPrompt: null },
      createdAt: new Date(), updatedAt: new Date(),
    };
    const configured = { ...assistant, id: "configured", name: "Configured checker" };
    const unfinished = { ...assistant, id: "unfinished", name: "Unfinished checker" };
    const welcome: AssistantWelcome = {
      assistantId: unfinished.id, runId: "setup", state: "ready", wasSkipped: false, answer: null, error: null, createdAt: new Date(),
      question: { header: "Setup", question: "How can I help?", options: [], idleMessage: "Ready", profileSetup: { turns: [] } },
    };
    const { onSelectAssistant, onSelectSkill, onClose } = renderDropdown({
      filterText: "testflight",
      assistantOverview: {
        assistants: [assistant, configured, unfinished, { ...assistant, id: "archived", name: "Archived checker", isArchived: true }],
        welcomes: [welcome, {
          ...welcome, assistantId: configured.id, runId: "configured-setup", state: "skipped", wasSkipped: true,
          question: { ...welcome.question!, profileSetup: { turns: [], saved: true } },
        }],
      },
    });
    expect(screen.getByText("Mates", { exact: true })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Call Beta checker" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Call Configured checker" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Call Unfinished checker" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Call Archived checker" })).toBeNull();
    await userEvent.setup().keyboard("{Enter}");
    expect(onSelectAssistant).toHaveBeenCalledExactlyOnceWith(assistant);
    expect(onSelectSkill).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UnifiedContextDropdown folders", () => {
  it("browses a Windows search result using a relative path and matches drive casing", async () => {
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { fileExplorer: { searchFiles: vi.fn().mockResolvedValue({ success: true, data: [{ ...directory, fullPath: "c:\\Repo\\src\\components" }] }) } },
    });
    const { onNavigateFile } = renderDropdown({ filterText: "components", workspacePath: "C:\\Repo" });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Browse components folder" }));
    expect(onNavigateFile).toHaveBeenCalledWith("src/components/");
    expect(screen.getByText("src")).toBeTruthy();
  });

  it("accepts Windows separators when entering a folder filter", async () => {
    const listDir = vi.fn().mockResolvedValue({ success: true, data: [] });
    const searchFiles = vi.fn().mockResolvedValue({ success: true, data: [] });
    Object.defineProperty(window, "api", { configurable: true, value: { fileExplorer: { listDir, searchFiles } } });
    renderDropdown({ filterText: "src\\components\\", workspacePath: "C:\\Repo" });
    await waitFor(() => expect(listDir).toHaveBeenCalledWith({ dirPath: "C:\\Repo\\src\\components" }));
    expect(searchFiles).not.toHaveBeenCalled();
  });

  it("does not mistake another repository with the same prefix for a workspace child", async () => {
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { fileExplorer: { listDir: vi.fn().mockResolvedValue({ success: true, data: [{ name: "notes.md", fullPath: "/repo-other/src/notes.md", type: "file" }] }) } },
    });
    renderDropdown();
    expect(await screen.findByText("/repo-other/src")).toBeTruthy();
  });

  it("keeps the combined menu loading while skills are still being discovered", async () => {
    const searchFiles = vi.fn().mockResolvedValue({ success: true, data: [] });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { fileExplorer: { searchFiles } },
    });
    renderDropdown({ providerId: "codex", filterText: "presentations", isLoadingSkills: true });
    await waitFor(() => expect(searchFiles).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByText("Loading files…")).toBeNull());
    expect(screen.queryByText("No matches")).toBeNull();
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("mentions a folder from the row and keeps browsing as a separate action", async () => {
    const listDir = vi.fn().mockResolvedValue({
      success: true,
      data: [directory],
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { fileExplorer: { listDir, searchFiles: vi.fn() } },
    });
    const user = userEvent.setup();
    const { onSelectFile, onNavigateFile, onClose } = renderDropdown();

    const folderRow = await screen.findByRole("menuitem", {
      name: /components/,
    });
    await user.click(folderRow);

    expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining(directory));
    expect(onNavigateFile).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("browses into a folder from its arrow without mentioning it", async () => {
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        fileExplorer: {
          listDir: vi.fn().mockResolvedValue({ success: true, data: [directory] }),
          searchFiles: vi.fn(),
        },
      },
    });
    const user = userEvent.setup();
    const { onSelectFile, onNavigateFile, onClose } = renderDropdown();

    const browseButton = await screen.findByRole("button", {
      name: "Browse components folder",
    });
    browseButton.focus();
    await user.keyboard("{Enter}");

    expect(onNavigateFile).toHaveBeenCalledWith("components/");
    expect(onSelectFile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("requests directories when searching the whole workspace", async () => {
    const searchFiles = vi.fn().mockResolvedValue({
      success: true,
      data: [directory],
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        fileExplorer: { listDir: vi.fn(), searchFiles },
      },
    });
    renderDropdown({ filterText: "components" });

    await waitFor(() => {
      expect(searchFiles).toHaveBeenCalledWith({
        rootPath: "/repo",
        query: "components",
        max: 150,
        includeDirectories: true,
      });
    });
  });
});
