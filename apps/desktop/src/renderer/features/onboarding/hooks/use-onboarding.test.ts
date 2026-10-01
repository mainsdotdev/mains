// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider, type ProviderProps } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import { fail, ok } from "../../../../shared/ipc-kit/service-response";
import { setTransport, resetTransport } from "@/lib/transport";
import { baseApi } from "@/lib/redux/api/baseApi";
import {
  appSettingsApi,
  type AppSettings,
} from "@/lib/redux/api/appSettingsApi";
import type { DetectedClis } from "@/lib/redux/api/providersApi";
import appSettingsReducer, {
  setTheme,
  setThemeChoice,
} from "@/lib/redux/slices/appSettingsSlice";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import backendsReducer from "@/lib/redux/slices/backendsSlice";
import { OnboardingScreen } from "../components/onboarding-screen";
import { useOnboarding } from "./use-onboarding";
import { AgentsStep } from "../components/agents-step";
import { onboardingProviders } from "../lib/onboarding-state";
import type { Space } from "@/lib/redux/api/spaceApi";
import type { Provider as AgentProvider } from "@/lib/redux/api/providersApi";
import { ProviderAuthNotice } from "@/features/workspace/components/provider-auth-notice";
import { ProviderCliSection } from "@/features/settings/components/provider-settings-shared";

vi.mock("@/features/workspace/components/terminal-section", () => ({
  TerminalSection: ({ pendingCommand }: { pendingCommand?: string }) =>
    createElement("div", { "data-testid": "auth-terminal" }, pendingCommand),
}));

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((media: string) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function createTestStore() {
  return configureStore({
    reducer: {
      appSettings: appSettingsReducer,
      workspace: workspaceReducer,
      backends: backendsReducer,
      [baseApi.reducerPath]: baseApi.reducer,
    },
    middleware: (defaults) => defaults().concat(baseApi.middleware),
  });
}

const stores: ReturnType<typeof createTestStore>[] = [];
function createHarness(
  options: {
    missing?: boolean;
    failDetection?: boolean;
    failSettings?: boolean;
    failSave?: boolean;
    saveGate?: Promise<void>;
    signedOut?: boolean;
  } = {},
) {
  let settings = {
    id: "settings",
    activeSpaceId: "claude-space",
    enableWorktrees: true,
    notifyOnRunComplete: true,
  } as AppSettings;
  let detected: DetectedClis = {
    claude: !options.missing,
    codex: !options.missing,
    copilot: false,
    cursor: false,
  };
  let signedOut = options.signedOut ?? false;
  const spaces = [
    {
      id: "claude-space",
      providerId: "claude_code",
      mode: "developer",
      sortOrder: 0,
      isArchived: false,
    },
    {
      id: "codex-space",
      providerId: "codex",
      mode: "developer",
      sortOrder: 1,
      isArchived: false,
    },
  ];
  const invoke = vi.fn(async (channel: string, args: unknown[] = []) => {
    if (channel === CHANNELS.appSettings.get)
      return options.failSettings ? fail("Settings unavailable") : ok(settings);
    if (channel === CHANNELS.space.getAll) return ok(spaces);
    if (channel === CHANNELS.providers.getEnabled)
      return ok(
        spaces.map((space) => ({
          id: space.providerId,
          kind: "agent_runtime",
          isEnabled: true,
        })),
      );
    if (channel === CHANNELS.providers.detectInstalled)
      return options.failDetection ? fail("Detection failed") : ok(detected);
    if (channel === CHANNELS.providers.getAccountInfo)
      return ok({
        account: signedOut ? null : { type: "claude", email: "account@example.test", planType: "Pro" },
        requiresOpenaiAuth: false,
        cli: {
          version: "2.1.283", channel: null, outdated: false,
          source: "bundled", updateMethod: "app",
          authLoginCommand: "'/Applications/Mains.app/bundled/claude' auth login",
        },
      });
    if (channel === CHANNELS.appSettings.update) {
      await options.saveGate;
      if (options.failSave) return fail("Save failed");
      settings = { ...settings, ...(args[0] as object) };
      return ok(settings);
    }
    throw new Error(`Unexpected channel: ${channel}`);
  });
  setTransport({
    kind: "test",
    invoke,
    subscribe: () => () => {},
    status: () => "connected",
    onStatusChange: () => () => {},
  });
  const store = createTestStore();
  stores.push(store);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      Provider,
      { store } as ProviderProps,
      createElement(MemoryRouter, null, children),
    );
  return {
    store,
    invoke,
    wrapper,
    setDetected: (next: DetectedClis) => {
      detected = next;
    },
    setSignedOut: (next: boolean) => {
      signedOut = next;
    },
  };
}

function moveToLastStep(result: { current: ReturnType<typeof useOnboarding> }) {
  for (let index = 0; index < 6 && !result.current.isLastStep; index++)
    act(() => result.current.goNext());
  expect(result.current.step).toBe("notifications");
  expect(result.current.isLastStep).toBe(true);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  stores
    .splice(0)
    .forEach((store) => store.dispatch(baseApi.util.resetApiState()));
  resetTransport();
});

describe("onboarding flow", () => {
  function bundledOptions() {
    return onboardingProviders(
      [{ id: "claude_code", kind: "agent_runtime", isEnabled: true }] as AgentProvider[],
      [{ id: "claude-space", providerId: "claude_code", mode: "developer", sortOrder: 0, isArchived: false }] as Space[],
      { claude: true, claudeSource: "bundled", codex: false, copilot: false, cursor: false },
      "claude-space",
    );
  }

  it("offers bundled Claude without requiring a separate installation", async () => {
    const harness = createHarness();
    const view = render(createElement(AgentsStep, {
      options: bundledOptions(), value: "claude", onChange: vi.fn(),
      isDetecting: false, hasError: false, onRecheck: vi.fn(),
    }), { wrapper: harness.wrapper });
    expect((view.getByRole("radio", { name: "Claude" }) as HTMLInputElement).disabled).toBe(false);
    await waitFor(() => expect(view.getByText("Included with Mains")).toBeTruthy());
    expect(view.queryByRole("button", { name: "Set up Claude" })).toBeNull();
    expect(view.queryByText("npm install -g @anthropic-ai/claude-code")).toBeNull();
  });

  it("opens a login terminal for the bundled executable when Claude is signed out", async () => {
    const harness = createHarness({ signedOut: true });
    const view = render(createElement(AgentsStep, {
      options: bundledOptions(), value: "claude", onChange: vi.fn(),
      isDetecting: false, hasError: false, onRecheck: vi.fn(),
    }), { wrapper: harness.wrapper });
    await waitFor(() => expect(view.getByRole("button", { name: "Sign in to Claude" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Sign in to Claude" }));
    fireEvent.click(view.getByRole("button", { name: "Sign in" }));
    expect(harness.store.getState().workspace.providerAuthTerminal).toMatchObject({
      providerId: "claude_code",
      pendingCommand: "'/Applications/Mains.app/bundled/claude' auth login",
    });
    expect(view.getByTestId("auth-terminal").textContent).toContain("bundled/claude");
    view.unmount();
    expect(harness.store.getState().workspace.providerAuthTerminal).toBeNull();
  });

  it("confirms a completed login in the open setup panel after recheck", async () => {
    const harness = createHarness({ signedOut: true });
    const onChange = vi.fn();
    const onRecheck = vi.fn();
    const view = render(createElement(AgentsStep, {
      options: bundledOptions(), value: "claude", onChange,
      isDetecting: false, hasError: false, onRecheck,
    }), { wrapper: harness.wrapper });
    await waitFor(() => expect(view.getByRole("button", { name: "Sign in to Claude" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Sign in to Claude" }));
    fireEvent.click(view.getByRole("button", { name: "Sign in" }));
    expect(view.getByTestId("auth-terminal")).toBeTruthy();

    harness.setSignedOut(false);
    fireEvent.click(view.getByRole("button", { name: "Recheck" }));
    await waitFor(() => expect(view.getByRole("heading", { name: "Signed in to Claude" })).toBeTruthy());
    expect(view.getByRole("region", { name: "Claude setup" })).toBeTruthy();
    expect(view.getByText(/Signed in as account@example\.test/)).toBeTruthy();
    expect(view.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(view.queryByTestId("auth-terminal")).toBeNull();
    expect(harness.store.getState().workspace.providerAuthTerminal).toBeNull();
    expect(onRecheck).toHaveBeenCalledOnce();

    fireEvent.click(view.getByRole("button", { name: "Use Claude" }));
    expect(onChange).toHaveBeenCalledWith("claude");
    expect(view.getByRole("radio", { name: "Claude" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("radio", { name: "Claude" })));
  });

  it("keeps the login terminal open when recheck still reports signed out", async () => {
    const harness = createHarness({ signedOut: true });
    const view = render(createElement(AgentsStep, {
      options: bundledOptions(), value: "claude", onChange: vi.fn(),
      isDetecting: false, hasError: false, onRecheck: vi.fn(),
    }), { wrapper: harness.wrapper });
    await waitFor(() => expect(view.getByRole("button", { name: "Sign in to Claude" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Sign in to Claude" }));
    fireEvent.click(view.getByRole("button", { name: "Sign in" }));
    const checksBefore = harness.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.providers.getAccountInfo).length;
    fireEvent.click(view.getByRole("button", { name: "Recheck" }));
    await waitFor(() => expect(harness.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.providers.getAccountInfo)).toHaveLength(checksBefore + 1));
    await waitFor(() => expect((view.getByRole("button", { name: "Recheck" }) as HTMLButtonElement).disabled).toBe(false));
    expect(view.getByRole("heading", { name: "Sign in to Claude" })).toBeTruthy();
    expect(view.getByTestId("auth-terminal")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Use Claude" })).toBeNull();
  });

  it("uses the runtime login command from a chat authentication notice", async () => {
    const harness = createHarness({ signedOut: true });
    const view = render(createElement(ProviderAuthNotice, {
      variant: "claude", title: "Sign in required",
    }), { wrapper: harness.wrapper });
    const signIn = view.getByRole("button", { name: "Sign in" }) as HTMLButtonElement;
    await waitFor(() => expect(signIn.disabled).toBe(false));
    fireEvent.click(signIn);
    expect(harness.store.getState().workspace.providerAuthTerminal).toMatchObject({
      pendingCommand: "'/Applications/Mains.app/bundled/claude' auth login",
    });
  });

  it("offers app-managed updates for bundled Claude instead of a CLI self-update", () => {
    const harness = createHarness();
    const view = render(createElement(ProviderCliSection, {
      providerId: "claude_code", cliName: "Claude Code CLI", shortName: "Claude",
      cli: { version: "2.1.283", channel: null, outdated: false, source: "bundled", updateMethod: "app" },
    }), { wrapper: harness.wrapper });
    expect(view.getByText("Included with Mains · Updates with the app")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Update CLI" })).toBeNull();
  });

  it("defaults worktrees off after settings load and lets a failed read be retried", async () => {
    const options = { failSettings: true };
    const harness = createHarness(options);
    const { result } = renderHook(useOnboarding, { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.settingsError).toBe(true));
    await waitFor(() => expect(result.current.selectedProvider).toBe("claude"));
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    expect(result.current.step).toBe("worktrees");
    expect(result.current.canContinue).toBe(false);
    options.failSettings = false;
    act(() => result.current.retrySettings());
    await waitFor(() => expect(result.current.canContinue).toBe(true));
    expect(result.current.enableWorktrees).toBe(false);
    expect(result.current.notifyOnRunComplete).toBe(true);
  });

  it("retains draft choices through Back, saves once, and completes only after success", async () => {
    let releaseSave!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const harness = createHarness({ saveGate: gate });
    harness.store.dispatch(
      setThemeChoice({
        providerId: "codex",
        appearance: "dark",
        choice: { theme: "dracula", accent: "theme" },
      }),
    );
    const { result } = renderHook(
      () => ({ flow: useOnboarding(), location: useLocation() }),
      { wrapper: harness.wrapper },
    );
    await waitFor(() =>
      expect(result.current.flow.selectedProvider).toBe("claude"),
    );
    expect(result.current.flow.enableWorktrees).toBe(false);
    expect(result.current.flow.notifyOnRunComplete).toBe(true);
    act(() => result.current.flow.goNext());
    act(() => {
      result.current.flow.chooseProvider("codex");
      result.current.flow.changeTheme("dark");
      result.current.flow.choosePreset("codex");
      result.current.flow.changeWorktrees(true);
      result.current.flow.changeNotifications(false);
    });
    act(() => result.current.flow.goNext());
    act(() => result.current.flow.goBack());
    expect(result.current.flow.selectedProvider).toBe("codex");
    expect(result.current.flow.enableWorktrees).toBe(true);
    expect(
      harness.store.getState().appSettings.appTheme.default.dark.theme,
    ).toBe("mains");
    moveToLastStep({
      get current() {
        return result.current.flow;
      },
    });
    act(() => {
      result.current.flow.goNext();
      result.current.flow.goNext();
    });
    expect(harness.store.getState().appSettings.onboardingCompleted).toBe(
      false,
    );
    expect(
      harness.invoke.mock.calls.filter(
        ([channel]) => channel === CHANNELS.appSettings.update,
      ),
    ).toHaveLength(1);
    await act(async () => releaseSave());
    await waitFor(() =>
      expect(harness.store.getState().appSettings.onboardingCompleted).toBe(
        true,
      ),
    );
    expect(
      harness.invoke.mock.calls.find(
        ([channel]) => channel === CHANNELS.appSettings.update,
      )?.[1],
    ).toEqual([
      {
        activeSpaceId: "codex-space",
        enableWorktrees: true,
        notifyOnRunComplete: false,
      },
    ]);
    expect(
      appSettingsApi.endpoints.getAppSettings.select()(harness.store.getState())
        .data?.activeSpaceId,
    ).toBe("codex-space");
    expect(harness.store.getState().appSettings.theme).toBe("dark");
    expect(
      harness.store.getState().appSettings.appTheme.default.dark.theme,
    ).toBe("codex");
    expect(
      harness.store.getState().appSettings.appTheme.providers.codex?.dark
        ?.theme,
    ).toBe("dracula");
    expect(result.current.location.pathname).toBe("/code");
    expect(
      harness.invoke.mock.calls.some(
        ([channel]) =>
          channel === CHANNELS.space.archive ||
          channel === CHANNELS.space.unarchive,
      ),
    ).toBe(false);
  });

  it("waits for workspace presentation after saving before completing onboarding", async () => {
    let reveal!: () => void;
    const presentation = new Promise<void>((resolve) => { reveal = resolve; });
    const beforeComplete = vi.fn(() => presentation);
    const harness = createHarness();
    const { result } = renderHook(() => useOnboarding(beforeComplete), { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.selectedProvider).toBe("claude"));
    moveToLastStep(result);
    act(() => result.current.goNext());
    await waitFor(() => expect(beforeComplete).toHaveBeenCalledOnce());
    expect(result.current.isCompleting).toBe(true);
    expect(result.current.canContinue).toBe(false);
    expect(harness.store.getState().appSettings.onboardingCompleted).toBe(false);
    act(() => { result.current.goBack(); result.current.goNext(); });
    expect(result.current.step).toBe("notifications");
    expect(beforeComplete).toHaveBeenCalledOnce();
    await act(async () => reveal());
    await waitFor(() => expect(harness.store.getState().appSettings.onboardingCompleted).toBe(true));
  });

  it("keeps the setup open when workspace presentation fails and lets it be retried", async () => {
    const beforeComplete = vi.fn().mockRejectedValueOnce(new Error("Window unavailable")).mockResolvedValue(undefined);
    const harness = createHarness();
    const { result } = renderHook(() => useOnboarding(beforeComplete), { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.selectedProvider).toBe("claude"));
    act(() => result.current.changeWorktrees(true));
    moveToLastStep(result);
    act(() => result.current.goNext());
    await waitFor(() => expect(result.current.saveError).toBeTruthy());
    expect(result.current.isCompleting).toBe(false);
    expect(result.current.enableWorktrees).toBe(true);
    expect(harness.store.getState().appSettings.onboardingCompleted).toBe(false);
    act(() => result.current.goNext());
    await waitFor(() => expect(harness.store.getState().appSettings.onboardingCompleted).toBe(true));
    expect(beforeComplete).toHaveBeenCalledTimes(2);
  });

  it("blocks unavailable providers but allows an explicit Set up later", async () => {
    const harness = createHarness({ missing: true });
    const { result } = renderHook(useOnboarding, { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.settingsReady).toBe(true));
    act(() => result.current.goNext());
    expect(result.current.canContinue).toBe(false);
    act(() => result.current.goNext());
    expect(result.current.step).toBe("providers");
    act(() => result.current.skipProvider());
    expect(result.current.step).toBe("theme");
    moveToLastStep(result);
    act(() => result.current.goNext());
    await waitFor(() =>
      expect(harness.store.getState().appSettings.onboardingCompleted).toBe(
        true,
      ),
    );
    expect(
      harness.invoke.mock.calls.find(
        ([channel]) => channel === CHANNELS.appSettings.update,
      )?.[1]?.[0],
    ).toEqual({
      activeSpaceId: "claude-space",
      enableWorktrees: false,
      notifyOnRunComplete: true,
    });
  });

  it("recovers from detection failure without pretending the CLI is ready", async () => {
    const harness = createHarness({ failDetection: true });
    const { result } = renderHook(useOnboarding, { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.providerError).toBe(true));
    act(() => result.current.goNext());
    expect(result.current.canContinue).toBe(false);
    act(() => result.current.skipProvider());
    moveToLastStep(result);
    expect(result.current.canContinue).toBe(true);
  });

  it("keeps the flow and drafts intact after a failed save and lets the user retry", async () => {
    const options = { failSave: true };
    const harness = createHarness(options);
    const { result } = renderHook(useOnboarding, { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.selectedProvider).toBe("claude"));
    act(() => result.current.changeWorktrees(true));
    moveToLastStep(result);
    act(() => result.current.goNext());
    await waitFor(() =>
      expect(result.current.saveError).toContain("Couldn’t save"),
    );
    expect(harness.store.getState().appSettings.onboardingCompleted).toBe(
      false,
    );
    expect(result.current.step).toBe("notifications");
    expect(result.current.enableWorktrees).toBe(true);
    options.failSave = false;
    act(() => result.current.goNext());
    await waitFor(() =>
      expect(harness.store.getState().appSettings.onboardingCompleted).toBe(
        true,
      ),
    );
  });

  it("requires another choice if the chosen CLI disappears after leaving the provider step", async () => {
    const harness = createHarness();
    const { result } = renderHook(useOnboarding, { wrapper: harness.wrapper });
    await waitFor(() => expect(result.current.selectedProvider).toBe("claude"));
    moveToLastStep(result);
    harness.setDetected({
      claude: false,
      codex: true,
      copilot: false,
      cursor: false,
    });
    act(() => result.current.recheckProviders());
    await waitFor(() =>
      expect(result.current.providerNeedsAttention).toBe(true),
    );
    expect(result.current.selectedProvider).toBe("claude");
    expect(result.current.canContinue).toBe(false);
    act(() => result.current.goNext());
    expect(
      harness.invoke.mock.calls.filter(
        ([channel]) => channel === CHANNELS.appSettings.update,
      ),
    ).toHaveLength(0);
  });

  it("finishes on the notification step while the final card is hidden", async () => {
    const harness = createHarness();
    const view = render(createElement(OnboardingScreen), {
      wrapper: harness.wrapper,
    });
    fireEvent.click(view.getByRole("button", { name: "Let’s begin" }));
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await view.findByRole("radio", { name: "Light" });
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await view.findByRole("radio", { name: /^Yes, use my current checkout\./ });
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    const finish = await view.findByRole("button", { name: "Get started" });
    const progress = view.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("5");
    expect(progress.getAttribute("aria-valuemax")).toBe("5");
    expect(view.queryByLabelText("Reserved card")).toBeNull();
    fireEvent.click(finish);
    await waitFor(() =>
      expect(harness.store.getState().appSettings.onboardingCompleted).toBe(
        true,
      ),
    );
  });

  it("uses the same provider guard for keyboard navigation and leaves radio arrows alone", async () => {
    const harness = createHarness({ missing: true });
    const view = render(createElement(OnboardingScreen), {
      wrapper: harness.wrapper,
    });
    fireEvent.click(view.getByRole("button", { name: "Let’s begin" }));
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled"),
      ).toBe(true),
    );
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "2",
    );
    fireEvent.click(view.getByRole("button", { name: "Set up later" }));
    await waitFor(() =>
      expect(view.getByRole("radio", { name: /^Light$/ })).toBeTruthy(),
    );
    fireEvent.keyDown(view.getByRole("radio", { name: /^Light$/ }), {
      key: "ArrowRight",
    });
    expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "3",
    );
  });

  it("respects the reduced-motion preference on the gradient and transition surface", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (media) =>
        ({
          matches: media === "(prefers-reduced-motion: reduce)",
          media,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    const harness = createHarness();
    const view = render(createElement(OnboardingScreen), {
      wrapper: harness.wrapper,
    });
    expect(view.getByRole("main").getAttribute("data-reduced-motion")).toBe(
      "true",
    );
  });

  it("keeps the appearance picker local and navigable without advancing setup", async () => {
    const harness = createHarness();
    harness.store.dispatch(setTheme("dark"));
    const view = render(createElement(OnboardingScreen), {
      wrapper: harness.wrapper,
    });
    fireEvent.click(view.getByRole("button", { name: "Let’s begin" }));
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Continue" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    const dark = await view.findByRole("radio", { name: "Dark" });
    expect(dark.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(dark, { key: "Home" });
    const light = view.getByRole("radio", { name: "Light" });
    expect(light.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(light);
    expect(view.getByRole("main").getAttribute("data-appearance")).toBe(
      "light",
    );
    fireEvent.keyDown(light, { key: "ArrowRight" });
    const auto = view.getByRole("radio", { name: "Auto" });
    expect(auto.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(auto, { key: "End" });
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(view.getByRole("main").getAttribute("data-appearance")).toBe("dark");
    expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "3",
    );
    expect(harness.store.getState().appSettings.theme).toBe("dark");
    expect(
      harness.invoke.mock.calls.some(
        ([channel]) => channel === CHANNELS.appSettings.update,
      ),
    ).toBe(false);
  });

  it("offers named copy controls and returns focus when closing install help", async () => {
    const harness = createHarness({ missing: true });
    const view = render(createElement(OnboardingScreen), {
      wrapper: harness.wrapper,
    });
    fireEvent.click(view.getByRole("button", { name: "Let’s begin" }));
    const trigger = await view.findByRole("button", { name: "Set up Copilot" });
    fireEvent.click(trigger);
    expect(
      view.getByRole("button", { name: "Copy install command" }),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Copy sign-in command" }),
    ).toBeTruthy();
    fireEvent.keyDown(view.getByRole("heading", { name: "Set up Copilot" }), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        view.getByRole("button", { name: "Set up Copilot" }),
      ),
    );
  });
});
