// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedClis } from "@mains/contracts/provider-cli";
import { PROVIDER_IDS } from "../../../../shared/provider-ids";

const mocks = vi.hoisted(() => ({
  detected: undefined as DetectedClis | undefined,
  detectRefetch: vi.fn(),
  accountRefetch: vi.fn(),
  updateCli: vi.fn(),
}));

vi.mock("@/lib/redux/api", () => ({
  useDetectInstalledClisQuery: () => ({ data: mocks.detected, isFetching: false, refetch: mocks.detectRefetch }),
  useGetProviderAccountInfoQuery: () => ({ data: undefined, isFetching: false, refetch: mocks.accountRefetch }),
  useUpdateProviderCliMutation: () => [mocks.updateCli, { isLoading: false }],
}));

import { ProviderAccountSection, ProviderCliSection } from "./provider-settings-shared";

const ALL_INSTALLED: DetectedClis = { claude: true, copilot: true, codex: true, cursor: true };

beforeEach(() => {
  mocks.detected = undefined;
  mocks.detectRefetch.mockReset();
  mocks.accountRefetch.mockReset();
  mocks.updateCli.mockReset();
});

afterEach(cleanup);

function renderCodexCli() {
  return render(
    <ProviderCliSection providerId={PROVIDER_IDS.codex} cliName="Codex CLI" shortName="Codex" cli={{ version: null, channel: null, outdated: false }}>
      <div>Codex compatibility row</div>
    </ProviderCliSection>,
  );
}

describe("ProviderCliSection", () => {
  it("offers the install command and a recheck in place of updating a CLI that isn't there", () => {
    mocks.detected = { ...ALL_INSTALLED, codex: false };
    renderCodexCli();

    expect(screen.getByText("Not installed")).toBeTruthy();
    expect(screen.getByText("npm install -g @openai/codex")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy install command" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open setup guide" }).getAttribute("href")).toBe("https://developers.openai.com/codex/cli");
    expect(screen.queryByRole("button", { name: "Update CLI" })).toBeNull();
    expect(screen.queryByText("Codex compatibility row")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));
    expect(mocks.detectRefetch).toHaveBeenCalledOnce();
    expect(mocks.accountRefetch).toHaveBeenCalledOnce();
  });

  it("asks to reinstall Mains when a bundled runtime is missing, with nothing to install", () => {
    mocks.detected = { ...ALL_INSTALLED, claude: false };
    render(<ProviderCliSection providerId={PROVIDER_IDS.claude} cliName="Claude Code CLI" shortName="Claude" cli={undefined} />);

    expect(screen.getByText(/Claude is included with Mains but missing from this installation/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy install command" })).toBeNull();
    expect(screen.getByRole("button", { name: "Recheck" })).toBeTruthy();
  });

  it("keeps the update controls while the probe hasn't answered or finds the CLI", () => {
    const view = renderCodexCli();
    expect(screen.getByRole("button", { name: "Update CLI" })).toBeTruthy();
    expect(screen.getByText("Codex compatibility row")).toBeTruthy();

    mocks.detected = ALL_INSTALLED;
    view.rerender(
      <ProviderCliSection providerId={PROVIDER_IDS.codex} cliName="Codex CLI" shortName="Codex" cli={{ version: "0.160.0", channel: null, outdated: false }} />,
    );
    expect(screen.getByText("Version 0.160.0")).toBeTruthy();
    expect(screen.queryByText("Not installed")).toBeNull();
  });

  it("shows why an update failed instead of a bare failure", async () => {
    mocks.detected = ALL_INSTALLED;
    mocks.updateCli.mockReturnValue({ unwrap: () => Promise.reject({ status: "CUSTOM_ERROR", error: "Codex CLI not found." }) });
    renderCodexCli();

    fireEvent.click(screen.getByRole("button", { name: "Update CLI" }));
    await waitFor(() => expect(screen.getByText("Codex CLI not found.")).toBeTruthy());
  });
});

describe("ProviderAccountSection", () => {
  const renderAccount = (providerId: string) =>
    render(<ProviderAccountSection providerId={providerId} isLoading={false} signedIn={null} notSignedInDescription="Run `agent login` in your terminal to authenticate" />);

  it("says to install a missing CLI before signing in", () => {
    mocks.detected = { ...ALL_INSTALLED, cursor: false };
    renderAccount(PROVIDER_IDS.cursor);
    expect(screen.getByText("Install the Cursor CLI below, then sign in.")).toBeTruthy();
    expect(screen.queryByText(/agent login/)).toBeNull();
  });

  it("keeps the provider's sign-in instructions once the CLI is found", () => {
    mocks.detected = ALL_INSTALLED;
    renderAccount(PROVIDER_IDS.cursor);
    expect(screen.getByText("Run `agent login` in your terminal to authenticate")).toBeTruthy();
  });
});
