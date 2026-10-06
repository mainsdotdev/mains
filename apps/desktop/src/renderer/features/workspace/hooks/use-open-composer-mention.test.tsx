// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextSkill } from "../lib/composer-context";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openDocument: vi.fn(), getPathInfo: vi.fn(), toastError: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/hooks/use-document-viewer", () => ({ useDocumentViewer: () => ({ open: mocks.openDocument }) }));
vi.mock("@/components/ui", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/lib/transport", () => ({ appApi: { fileExplorer: { getPathInfo: mocks.getPathInfo } } }));
import { useOpenComposerMention } from "./use-open-composer-mention";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("composer skill and plugin navigation", () => {
  it("opens a plugin by its exact id and provider, preserving reserved characters", async () => {
    const id = "app-gmail@market/place?version=1&name=Gmail";
    const { result } = renderHook(() => useOpenComposerMention([
      { name: "gmail", scope: "plugin", mentionPath: `plugin://${id}` },
    ], "codex"));
    await act(() => result.current("gmail"));
    const url = new URL(mocks.navigate.mock.lastCall![0], "https://mains.local");
    expect(url.pathname).toBe("/plugins");
    expect(url.searchParams.get("plugin")).toBe(id);
    expect(url.searchParams.get("provider")).toBe("codex");
    expect(mocks.openDocument).not.toHaveBeenCalled();
  });

  it("opens an existing SKILL.md in the Markdown document viewer", async () => {
    const path = "/Users/user/.agents/skills/apple-design/SKILL.md";
    mocks.getPathInfo.mockResolvedValue({ success: true, data: { isFile: true } });
    const { result } = renderHook(() => useOpenComposerMention([{ name: "apple-design", path }], "claude_code"));
    await act(() => result.current("apple-design"));
    expect(mocks.getPathInfo).toHaveBeenCalledWith(path);
    expect(mocks.openDocument).toHaveBeenCalledWith({ path, fileName: "SKILL.md", docType: "md" });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each([
    { success: true, data: { isFile: false } },
    { success: false, error: "unavailable" },
  ])("reports unavailable skill files without opening a document", async (response) => {
    mocks.getPathInfo.mockResolvedValue(response);
    const { result } = renderHook(() => useOpenComposerMention([{ name: "missing", path: "/gone/SKILL.md" }], "codex"));
    await act(() => result.current("missing"));
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledOnce();
  });

  it("handles failed path checks", async () => {
    mocks.getPathInfo.mockRejectedValue(new Error("disconnected"));
    const { result } = renderHook(() => useOpenComposerMention([{ name: "skill", path: "/skill/SKILL.md" }], "codex"));
    await act(() => result.current("skill"));
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Unable to open skill file");
  });

  it("ignores mentions without a skill document or plugin identity", async () => {
    const skills: ContextSkill[] = [
      { name: "builtin" }, { name: "directory", path: "/skills/directory" },
      { name: "plugin", scope: "plugin", mentionPath: "plugin://" },
      { name: "mac-app", scope: "computer", path: "/Applications/App.app" },
    ];
    const { result } = renderHook(() => useOpenComposerMention(skills, "codex"));
    for (const name of [...skills.map((skill) => skill.name), "not-in-context"]) {
      await act(() => result.current(name));
    }
    expect(mocks.getPathInfo).not.toHaveBeenCalled();
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
