// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ finishLoading: undefined as (() => void) | undefined }));
vi.mock("@/hooks/use-space-provider-variant", () => ({
  useSpaceProviderVariant: () => ({ providerId: "codex", supportsPlugins: true }),
}));
vi.mock("@/features/settings/components/provider-plugins", async () => {
  await new Promise<void>((resolve) => { mocks.finishLoading = resolve; });
  return { default: () => <div>Installed plugins</div> };
});
import PluginsPage from "./Plugins";

afterEach(cleanup);

describe("Plugins page loading", () => {
  it("opens the page shell before its plugin content has loaded", async () => {
    render(<PluginsPage />);
    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading plugins…");
    await waitFor(() => expect(mocks.finishLoading).toBeTypeOf("function"));
    await act(async () => mocks.finishLoading!());
    expect(await screen.findByText("Installed plugins")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
  });
});
