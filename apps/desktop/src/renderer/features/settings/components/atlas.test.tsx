// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasAutoTagging } from "@mains/contracts/atlas";
import AtlasSettings from "./atlas";

const mocks = vi.hoisted(() => ({
  config: { enabled: false, providerId: "", model: "" } as AtlasAutoTagging | undefined,
  accountId: "account" as string | undefined,
  error: undefined as Error | undefined,
  save: vi.fn(), success: vi.fn(), preferences: vi.fn(), models: vi.fn(), refetch: vi.fn(),
}));
vi.mock("@/lib/redux/api", () => ({
  useGetAccountQuery: () => ({ data: mocks.accountId ? { id: mocks.accountId } : undefined, isLoading: !mocks.accountId, refetch: mocks.refetch }),
  useGetProvidersQuery: () => ({ data: [
    { id: "codex", displayName: "OpenAI Codex (CLI/SDK)", isEnabled: true },
    { id: "claude_code", displayName: "Claude Code (Local Agent)", isEnabled: true },
    { id: "disabled", displayName: "Disabled provider", isEnabled: false },
  ] }),
  useGetProviderModelsQuery: (id: string, options: { skip: boolean }) => {
    mocks.models(id, options);
    return { currentData: id === "codex" ? [{ id: "small-codex", displayName: "Small Codex" }]
      : id === "claude_code" ? [{ id: "small-claude", displayName: "Small Claude" }] : [] };
  },
}));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useAtlasAutoTaggingQuery: (input: unknown, options: unknown) => {
    mocks.preferences(input, options);
    return { currentData: mocks.config, error: mocks.error, refetch: mocks.refetch };
  },
  useSetAtlasAutoTaggingMutation: () => [mocks.save, { isLoading: false }],
}));
vi.mock("@/lib/redux/hooks", () => ({ useAppSelector: () => "backend" }));
vi.mock("@/lib/transport", () => ({ getTransport: () => "backend" }));
vi.mock("@/components/ui", async (original) => ({ ...await original<typeof import("@/components/ui")>(), toast: { success: mocks.success } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config = { enabled: false, providerId: "", model: "" };
  mocks.accountId = "account"; mocks.error = undefined;
  mocks.save.mockReturnValue({ unwrap: async () => ({}) });
  document.documentElement.style.fontSize = "16px";
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Atlas settings", () => {
  it("saves automatic tagging with the provider and model chosen through shared Select controls", async () => {
    render(<AtlasSettings />);
    expect(screen.getByRole("heading", { name: "Atlas" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Automatically tag bookmarks" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Atlas provider" }));
    expect(screen.queryByRole("option", { name: "Disabled provider" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Atlas model" }));
    fireEvent.click(screen.getByRole("option", { name: "Small Codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Atlas settings saved"));
    expect(mocks.save).toHaveBeenCalledWith({ accountId: "account", config: { enabled: true, providerId: "codex", model: "small-codex" } });
    expect(mocks.models).toHaveBeenCalledWith("codex", { skip: false });
  });
  it("clears the previous model when the provider changes", () => {
    mocks.config = { enabled: true, providerId: "claude_code", model: "small-claude" };
    render(<AtlasSettings />);
    expect(screen.getByRole("button", { name: "Atlas model" }).textContent).toContain("Small Claude");
    fireEvent.click(screen.getByRole("button", { name: "Atlas provider" }));
    fireEvent.click(screen.getByRole("option", { name: "Codex" }));
    expect(screen.getByRole("button", { name: "Atlas model" }).textContent).toContain("Choose a model");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("preserves the chosen configuration after a failed save", async () => {
    mocks.config = { enabled: false, providerId: "codex", model: "small-codex" };
    mocks.save.mockReturnValue({ unwrap: async () => { throw new Error("Selected model is unavailable"); } });
    render(<AtlasSettings />);
    fireEvent.click(screen.getByRole("switch", { name: "Automatically tag bookmarks" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Selected model is unavailable");
    expect(screen.getByRole("button", { name: "Atlas model" }).textContent).toContain("Small Codex");
    expect(screen.getByRole("switch", { name: "Automatically tag bookmarks" }).getAttribute("aria-checked")).toBe("true");
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("shows a retry action when preferences cannot be loaded", () => {
    mocks.config = undefined; mocks.error = new Error("Cannot connect to Atlas");
    render(<AtlasSettings />);
    expect(screen.getByText("Cannot connect to Atlas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
  it("waits for the account before requesting Atlas preferences", () => {
    mocks.accountId = undefined; mocks.config = undefined;
    render(<AtlasSettings />);
    expect(screen.getByText("Loading Atlas settings…")).toBeTruthy();
    expect(mocks.preferences).toHaveBeenCalledWith({ accountId: "" }, { skip: true });
    expect(mocks.models).not.toHaveBeenCalled();
  });
});
