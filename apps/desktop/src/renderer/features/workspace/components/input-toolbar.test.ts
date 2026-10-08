// @vitest-environment jsdom

import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_CONFIGS } from "@/lib/mode-config";

const mocks = vi.hoisted(() => ({ mode: "developer" as "developer" | "work" | "chat" }));

vi.mock("@/hooks/use-mode-config", () => ({
  useModeConfig: () => MODE_CONFIGS[mocks.mode],
}));

import { InputToolbar } from "./input-toolbar";
import { hasComposerMessage } from "../lib/composer-message";
import { composerControls, stopComposerActivity } from "../lib/composer-controls";

function nativeToolbarProps(): Parameters<typeof InputToolbar>[0] {
  return {
    variant: "codex", isLoading: false,
    selectedModelDisplayName: "gpt-5", modelDisplayNames: ["gpt-5"], onModelChange: vi.fn(), isLoadingModels: false,
    modelEffortLevelsByDisplayName: { "gpt-5": ["medium"] }, uploadedFiles: [], onUploadedFilesChange: vi.fn(),
    permissionMode: "workspace-write", onPermissionModeChange: vi.fn(),
    thinkingMode: true, onThinkingModeToggle: vi.fn(), fastMode: false, onFastModeToggle: vi.fn(), supportsFastMode: false,
    effortLevel: "medium", onEffortLevelChange: vi.fn(),
    primaryAction: { kind: "send", disabled: false, label: "Send prompt", onClick: vi.fn() },
  };
}

beforeEach(() => { mocks.mode = "developer"; });

describe("floating composer controls", () => {
  it("confirms every Codex Full Access selection before changing the mode", () => {
    const props = nativeToolbarProps();
    const { rerender } = render(createElement(InputToolbar, props));
    const chooseFullAccess = () => {
      fireEvent.click(screen.getByRole("button", { name: "Permission mode" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: /Full Access/ }));
    };

    chooseFullAccess();
    expect(props.onPermissionModeChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Turn on Full Access?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onPermissionModeChange).not.toHaveBeenCalled();

    chooseFullAccess();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(props.onPermissionModeChange).toHaveBeenCalledExactlyOnceWith("danger-full-access");

    rerender(createElement(InputToolbar, { ...props, permissionMode: "danger-full-access" }));
    chooseFullAccess();
    expect(screen.getByRole("dialog", { name: "Turn on Full Access?" })).toBeTruthy();
    expect(props.onPermissionModeChange).toHaveBeenCalledTimes(1);
  });

  it.each(["work", "chat"] as const)("retains Fast and model controls while hiding permissions in %s mode", (mode) => {
    mocks.mode = mode;
    const props = { ...nativeToolbarProps(), layout: "floating" as const, supportsFastMode: true, fastMode: true };
    render(createElement(InputToolbar, props));
    expect(screen.getByRole("button", { name: "Model and effort" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Permission mode" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Fast/ }));
    expect(props.onFastModeToggle).toHaveBeenCalledOnce();
  });

  it("keeps attachment, model and effort, permissions, and send in one row", () => {
    const onSubmit = vi.fn();
    const props: Parameters<typeof InputToolbar>[0] = {
      variant: "codex",
      layout: "floating",
      isLoading: false,
      primaryAction: { kind: "send", disabled: false, label: "Send prompt", onClick: onSubmit },
      selectedModelDisplayName: "gpt-5",
      modelDisplayNames: ["gpt-5"],
      modelEffortLevelsByDisplayName: { "gpt-5": ["medium"] },
      onModelChange: vi.fn(),
      isLoadingModels: false,
      permissionMode: "workspace-write",
      onPermissionModeChange: vi.fn(),
      thinkingMode: true,
      onThinkingModeToggle: vi.fn(),
      fastMode: false,
      onFastModeToggle: vi.fn(),
      supportsFastMode: false,
      effortLevel: "medium",
      onEffortLevelChange: vi.fn(),
      uploadedFiles: [],
      onUploadedFilesChange: vi.fn(),
    };
    const { rerender } = render(createElement(InputToolbar, props));

    const controls = [
      screen.getByRole("button", { name: "Upload file" }),
      screen.getByRole("button", { name: "Model and effort" }),
      screen.getByRole("button", { name: "Permission mode" }),
      screen.getByRole("button", { name: "Send prompt" }),
    ];
    for (let i = 0; i < controls.length - 1; i++) {
      expect(controls[i].compareDocumentPosition(controls[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    fireEvent.click(controls[1]);
    expect(controls[1].getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("menu", { name: "Model selection" }).className,
    ).toContain("right-0");
    fireEvent.click(controls[2]);
    expect(controls[2].getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("menu", { name: "Permission mode" }).className,
    ).toContain("right-0");
    const selectedIcon = () => screen.getByRole("menu", { name: "Permission mode" })
      .querySelector('[role="menuitemradio"][aria-checked="true"] svg')?.innerHTML;
    expect(controls[2].querySelector("svg")?.innerHTML).toBe(selectedIcon());
    const writeIcon = controls[2].querySelector("svg")?.innerHTML;
    rerender(createElement(InputToolbar, { ...props, permissionMode: "read-only" }));
    expect(controls[2].querySelector("svg")?.innerHTML).toBe(selectedIcon());
    expect(controls[2].querySelector("svg")?.innerHTML).not.toBe(writeIcon);
    fireEvent.click(controls[3]);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("closes floating composer menus and the effort submenu when focus mode changes", () => {
    const props: Parameters<typeof InputToolbar>[0] = {
      variant: "codex",
      layout: "floating",
      floatingChatMode: "details",
      isLoading: false,
      primaryAction: { kind: "send", disabled: false, label: "Send prompt", onClick: vi.fn() },
      selectedModelDisplayName: "gpt-5",
      modelDisplayNames: ["gpt-5"],
      modelEffortLevelsByDisplayName: { "gpt-5": ["medium"] },
      onModelChange: vi.fn(),
      isLoadingModels: false,
      permissionMode: "workspace-write",
      onPermissionModeChange: vi.fn(),
      thinkingMode: true,
      onThinkingModeToggle: vi.fn(),
      fastMode: false,
      onFastModeToggle: vi.fn(),
      supportsFastMode: false,
      effortLevel: "medium",
      onEffortLevelChange: vi.fn(),
      uploadedFiles: [],
      onUploadedFilesChange: vi.fn(),
    };
    const { rerender } = render(createElement(InputToolbar, props));
    const model = screen.getByRole("button", { name: "Model and effort" });
    const permission = screen.getByRole("button", { name: "Permission mode" });
    const attachment = screen.getByRole("button", { name: "Upload file" });

    fireEvent.click(attachment);
    fireEvent.click(model);
    fireEvent.mouseEnter(screen.getByRole("menuitemradio", { checked: true }));
    fireEvent.click(permission);
    expect(screen.getAllByRole("menu").length).toBeGreaterThanOrEqual(3);

    rerender(createElement(InputToolbar, { ...props, floatingChatMode: "input" }));
    expect(screen.queryAllByRole("menu")).toHaveLength(0);
    expect(model.getAttribute("aria-expanded")).toBe("false");
    expect(permission.getAttribute("aria-expanded")).toBe("false");
    expect(attachment.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(model);
    expect(screen.getByRole("menu", { name: "Model selection" })).toBeTruthy();
    expect(screen.queryByRole("menu", { name: /effort level/i })).toBeNull();

    rerender(createElement(InputToolbar, { ...props, floatingChatMode: "icon" }));
    expect(screen.queryAllByRole("menu")).toHaveLength(0);
  });
});

const idleComposer = {
  state: { phase: "idle" as const, runId: null, muted: false }, runId: "chat", isNewRun: false,
  isRunning: false, canSendDuringRun: false, voiceEnabled: true, hasMessage: false, preparing: false, startDisabled: false, sendDisabled: false,
};

describe("single primary composer button", () => {
  it.each(["new", "existing"])("switches the %s chat between microphone and Send for text or attachments, without an extra voice button", (kind) => {
    const props = nativeToolbarProps();
    const onStart = vi.fn();
    const onSubmit = vi.fn();
    const primaryAction = (text: string, attachments = 0) => {
      const { primary } = composerControls({ ...idleComposer,
        isNewRun: kind === "new", runId: kind === "new" ? undefined : "chat",
        hasMessage: hasComposerMessage(text, attachments, []), sendDisabled: !text.trim() && attachments === 0,
      });
      return { ...primary, onClick: primary.kind === "voice" ? onStart : onSubmit };
    };
    const { rerender } = render(createElement(InputToolbar, { ...props, primaryAction: primaryAction("  ") }));
    const start = screen.getByRole("button", { name: "Start voice chat" });
    expect(screen.getAllByRole("button", { name: "Start voice chat" })).toHaveLength(1);
    const microphoneIcon = start.querySelector('[data-active="true"] svg')?.innerHTML;
    expect(microphoneIcon).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send prompt" })).toBeNull();
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();

    for (const action of [primaryAction("hello"), primaryAction("", 1)]) {
      rerender(createElement(InputToolbar, { ...props, primaryAction: action }));
      expect(screen.queryByRole("button", { name: "Start voice chat" })).toBeNull();
      const send = screen.getByRole("button", { name: "Send prompt" });
      expect(send.querySelector('[data-active="true"] svg')?.innerHTML).not.toBe(microphoneIcon);
      fireEvent.click(send);
    }
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenCalledOnce();

    rerender(createElement(InputToolbar, { ...props, primaryAction: primaryAction("") }));
    expect((screen.getByRole("button", { name: "Start voice chat" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: /mute microphone/i })).toBeNull();
  });

  it("puts mute immediately before the call's Stop and changes its icon when muted", () => {
    const props = nativeToolbarProps();
    const onMute = vi.fn();
    const controls = (muted: boolean) => {
      const value = composerControls({ ...idleComposer, state: { phase: "connected", runId: "chat", muted }, hasMessage: true });
      return { primaryAction: { ...value.primary, onClick: props.primaryAction.onClick },
        voiceMute: { ...value.mute!, onToggle: onMute } };
    };
    const { rerender } = render(createElement(InputToolbar, {
      ...props, ...controls(false),
    }));
    const mute = screen.getByRole("button", { name: "Mute microphone" });
    const end = screen.getByRole("button", { name: "End voice chat" });
    const unmutedIcon = mute.querySelector("svg")?.innerHTML;
    expect(mute.querySelector("rect")).not.toBeNull();
    expect(mute.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Array.from(end.parentElement!.closest(".shrink-0")!.querySelectorAll("button"))).toEqual([mute, end]);
    fireEvent.click(mute);
    expect(onMute).toHaveBeenCalledOnce();
    fireEvent.click(end);
    expect(props.primaryAction.onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Start voice chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send prompt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop run" })).toBeNull();

    rerender(createElement(InputToolbar, { ...props, ...controls(true) }));
    const unmute = screen.getByRole("button", { name: "Unmute microphone" });
    expect(unmute.getAttribute("aria-pressed")).toBe("true");
    expect(unmute.querySelector("svg")?.innerHTML).not.toBe(unmutedIcon);
    fireEvent.click(unmute);
    expect(onMute).toHaveBeenCalledTimes(2);
  });

  it.each(["default", "floating"] as const)("switches running work from Stop to queued Send and back in the %s composer", (layout) => {
    const props = nativeToolbarProps();
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    const controls = (text: string, attachments = 0, sendLabel = "Queue message") => {
      const { primary } = composerControls({ ...idleComposer, isRunning: true, canSendDuringRun: true,
        hasMessage: hasComposerMessage(text, attachments, []), sendLabel });
      return { ...primary, onClick: primary.kind === "stop" ? onStop : onSubmit };
    };
    const { rerender } = render(createElement(InputToolbar, { ...props, layout, primaryAction: controls("") }));
    expect(screen.getByRole("button", { name: "Stop run" })).toBeTruthy();
    for (const [text, attachments, label] of [["next message", 0, "Queue message"], ["", 1, "Queue message"], ["edited", 0, "Save queued message"]] as const) {
      rerender(createElement(InputToolbar, { ...props, layout, primaryAction: controls(text, attachments, label) }));
      expect(screen.queryByRole("button", { name: "Stop run" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: label }));
    }
    expect(onSubmit).toHaveBeenCalledTimes(3);
    expect(onStop).not.toHaveBeenCalled();
    rerender(createElement(InputToolbar, { ...props, layout, primaryAction: controls("  ") }));
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("uses the same Stop to close voice and stop work without submitting draft text", () => {
    const props = nativeToolbarProps();
    const stopVoice = vi.fn();
    const stopRun = vi.fn();
    const controls = composerControls({ ...idleComposer, isRunning: true, hasMessage: true,
      state: { phase: "connected", runId: "chat", muted: false } });
    render(createElement(InputToolbar, { ...props,
      primaryAction: { ...controls.primary, onClick: () => { void stopComposerActivity({ stopVoice, stopRun }); } },
      voiceMute: { ...controls.mute!, onToggle: vi.fn() },
    }));
    expect(screen.getAllByRole("button", { name: "Stop voice chat and run" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop voice chat and run" }));
    expect(stopVoice).toHaveBeenCalledOnce();
    expect(stopRun).toHaveBeenCalledOnce();
    expect(props.primaryAction.onClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Send prompt|Start voice chat/ })).toBeNull();
  });

  it("disables the microphone when not ready and keeps clients without native voice on Send", () => {
    const props = nativeToolbarProps();
    const action = (voiceEnabled: boolean) => ({ ...composerControls({ ...idleComposer,
      voiceEnabled, startDisabled: true, sendDisabled: true }).primary, onClick: props.primaryAction.onClick });
    const { rerender } = render(createElement(InputToolbar, { ...props, primaryAction: action(true) }));
    fireEvent.click(screen.getByRole("button", { name: "Start voice chat" }));
    expect(props.primaryAction.onClick).not.toHaveBeenCalled();
    rerender(createElement(InputToolbar, { ...props, variant: "claude", primaryAction: action(false) }));
    expect(screen.queryByRole("button", { name: "Start voice chat" })).toBeNull();
    expect((screen.getByRole("button", { name: "Send prompt" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
