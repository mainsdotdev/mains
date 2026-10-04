// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { RealtimeVoiceState } from "../lib/realtime-voice-controller";
import { voiceChatPresence } from "../lib/voice-chat-presence";
import { useRealtimeVoiceLifecycle } from "../hooks/use-realtime-voice";
import { useVoiceChatPresence } from "../hooks/use-voice-chat-presence";
import { RealtimeVoiceBar } from "./realtime-voice-bar";
import { RealtimeVoiceDock } from "./realtime-voice-dock";

const h = vi.hoisted(() => {
  let snapshot: RealtimeVoiceState;
  const listeners = new Set<() => void>();
  const patch = (change: Partial<RealtimeVoiceState>) => {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  };
  const voice = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    start: vi.fn(), stop: vi.fn(async () => {}),
    toggleMute: vi.fn(() => patch({ muted: !snapshot.muted })),
    getAudioLevels: vi.fn(() => ({ input: 0.4, output: 0.6 })),
  };
  const transport = () => {
    const statusListeners = new Set<(status: string) => void>();
    return {
      statusListeners,
      onStatusChange: vi.fn((listener: (status: string) => void) => {
        statusListeners.add(listener); return () => { statusListeners.delete(listener); };
      }),
    };
  };
  return {
    voice, patch, factory: vi.fn(() => voice), jump: vi.fn(async () => {}), toastError: vi.fn(),
    local: transport(), remote: transport(), active: undefined as ReturnType<typeof transport> | undefined,
    transportChange: undefined as (() => void) | undefined,
    run: null as any,
  };
});

vi.mock("../lib/realtime-voice-controller", () => ({ createRealtimeVoiceController: h.factory }));
vi.mock("@/lib/transport", () => ({
  getTransport: () => h.active,
  onTransportChange: (listener: () => void) => { h.transportChange = listener; return () => { h.transportChange = undefined; }; },
}));
vi.mock("@/lib/redux/api", () => ({
  useGetRunByIdQuery: (id: string, { skip }: { skip: boolean }) => ({ currentData: !skip && id === h.run?.id ? h.run : null }),
  useGetProviderByIdQuery: () => ({ data: { config: { voiceOrbColor: "rose", voiceOrbStyle: "sphere" } } }),
}));
vi.mock("../hooks/use-jump-to-run", () => ({ useJumpToRun: () => h.jump }));
vi.mock("@/components/ui", () => ({
  toast: { error: h.toastError },
  Button: ({ children, tooltip: _tooltip, ...props }: any) => <button {...props}>{children}</button>,
  Text: ({ children, as: Tag = "span", size: _size, tone: _tone, weight: _weight, ...props }: any) => <Tag {...props}>{children}</Tag>,
}));
vi.mock("./voice-orb", () => ({
  VoiceOrb: ({ active, className, color, orbStyle, getAudioLevels }: any) => <span data-testid="orb" data-active={active} data-size={className ? "compact" : "full"}
    data-color={color} data-orb-style={orbStyle} data-output={getAudioLevels(0).output} />,
}));

const owner = { id: "voice", title: "Original voice chat", spaceId: "original-space", workspaceId: "original-workspace",
  collectionId: null, providerId: "codex", mode: "developer", isArchived: false };
const destinations = {
  "Own chat": "/code/runs/voice",
  "Another chat": "/code/runs/worker",
  "Same workspace chat": "/code/workspace?chat=worker",
  "Editor": "/code/workspace?tab=editor",
  "Settings": "/settings?section=codex",
  "Plugins": "/plugins",
};

function ChatPage({ displayedRunId, composerRunId }: { displayedRunId: string | null; composerRunId: string }) {
  useVoiceChatPresence(displayedRunId);
  return <RealtimeVoiceBar runId={composerRunId} />;
}

function Shell() {
  useRealtimeVoiceLifecycle();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const displayedRunId = pathname === "/code/runs/voice" ? "voice"
    : pathname === "/code/runs/worker" || search === "?chat=worker" ? "worker" : null;
  return <>
    {Object.entries(destinations).map(([label, path]) => <button key={label} onClick={() => navigate(path)}>{label}</button>)}
    <RealtimeVoiceDock />
    {pathname.startsWith("/code") && <ChatPage displayedRunId={displayedRunId} composerRunId={displayedRunId ?? "voice"} />}
  </>;
}

function mount(path = destinations["Own chat"]) {
  return render(<MemoryRouter initialEntries={[path]}><Shell /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.active = h.local;
  h.run = { ...owner };
  h.patch({ phase: "connected", runId: "voice", connectionId: "call", startedAt: 1,
    label: "Codex", muted: false, error: null, transcripts: [] });
});
afterEach(() => { cleanup(); });

describe("voice call across navigation", () => {
  it("moves the same call between its full orb and compact controls without ending or restarting it", () => {
    mount();
    const ownersCreated = h.factory.mock.calls.length;
    expect(screen.getByTestId("orb").dataset.size).toBe("full");
    expect(screen.getByTestId("orb").dataset.orbStyle).toBe("sphere");
    expect(screen.queryByRole("button", { name: "Return to voice chat" })).toBeNull();
    for (const destination of ["Another chat", "Same workspace chat", "Editor", "Settings", "Plugins"]) {
      fireEvent.click(screen.getByRole("button", { name: destination }));
      expect(screen.getAllByRole("region", { name: "Voice chat controls" })).toHaveLength(1);
      expect(screen.getByTestId("orb").dataset.size).toBe("compact");
      expect(screen.getByTestId("orb").dataset.color).toBe("rose");
      expect(screen.getByTestId("orb").dataset.orbStyle).toBe("sphere");
      expect(screen.getByTestId("orb").dataset.output).toBe("0.6");
      expect(screen.getByRole("button", { name: "Return to voice chat" }).textContent).toContain(owner.title);
      expect(h.voice.stop).not.toHaveBeenCalled();
      expect(h.voice.start).not.toHaveBeenCalled();
      expect(h.factory).toHaveBeenCalledTimes(ownersCreated);
    }
    fireEvent.click(screen.getByRole("button", { name: "Return to voice chat" }));
    expect(h.jump).toHaveBeenCalledExactlyOnceWith(h.run);
    fireEvent.click(screen.getByRole("button", { name: "Own chat" }));
    expect(screen.getAllByTestId("orb")).toHaveLength(1);
    expect(screen.getByTestId("orb").dataset.size).toBe("full");
    expect(h.voice.stop).not.toHaveBeenCalled();
  });

  it("shares mute state with the original chat and keeps compact end controls reachable", () => {
    mount(destinations.Settings);
    fireEvent.click(screen.getByRole("button", { name: "Mute microphone" }));
    expect(h.voice.toggleMute).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Unmute microphone" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Own chat" }));
    expect(screen.queryByRole("button", { name: "Unmute microphone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End voice chat" })).toBeNull();
    expect(screen.getByTestId("orb").dataset.size).toBe("full");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Unmute microphone" }));
    expect(h.voice.toggleMute).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "End voice chat" }));
    expect(h.voice.stop).toHaveBeenCalledOnce();
  });

  it("keeps connecting, pending closure, retry and error dismissal reachable outside the chat", () => {
    h.patch({ phase: "connecting" });
    mount(destinations.Plugins);
    expect((screen.getByRole("button", { name: "Mute microphone" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "End voice chat" }) as HTMLButtonElement).disabled).toBe(false);
    const orb = screen.getByTestId("orb");
    const visual = orb.closest(".voice-orb-connection")!;
    expect(visual.getAttribute("data-connecting")).toBe("true");
    expect(orb.dataset.active).toBe("false");
    act(() => h.patch({ phase: "connected" }));
    expect((screen.getByRole("button", { name: "Mute microphone" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("orb")).toBe(orb);
    expect(orb.closest(".voice-orb-connection")).toBe(visual);
    expect(visual.getAttribute("data-connecting")).toBe("false");
    expect(orb.dataset.active).toBe("true");
    act(() => h.patch({ phase: "ending" }));
    expect((screen.getByRole("button", { name: "End voice chat" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("The microphone is off. Waiting for voice chat to end.")).toBeNull();
    act(() => h.patch({ phase: "stop_failed", error: "Native closure not confirmed" }));
    expect(h.toastError).toHaveBeenCalledExactlyOnceWith("Native closure not confirmed");
    expect(screen.queryByRole("button", { name: "Mute microphone" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry ending voice chat" }));
    expect(h.voice.stop).toHaveBeenCalledOnce();
    act(() => h.patch({ phase: "error", error: "Audio connection failed" }));
    expect(h.toastError).toHaveBeenLastCalledWith("Audio connection failed");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss voice error" }));
    expect(h.voice.stop).toHaveBeenCalledTimes(2);
  });

  it.each(["connecting", "connected", "ending", "stop_failed", "error"] as const)("keeps a full visual slot without text or controls during %s", (phase) => {
    h.patch({ phase });
    mount();
    const region = screen.getByRole("region", { name: "Voice chat controls" });
    expect(region.textContent).toBe("");
    expect(region.querySelector("button")).toBeNull();
    expect(screen.getByTestId("orb").dataset.size).toBe("full");
    expect(region.getAttribute("aria-busy")).toBe(String(phase === "connecting"));
    expect(region.querySelector(".voice-orb-connection")?.getAttribute("data-connecting")).toBe(String(phase === "connecting"));
    expect(screen.getByTestId("orb").dataset.active).toBe(String(phase === "connected"));
  });

  it("reports a voice failure once while transcript and route updates continue", () => {
    mount();
    act(() => h.patch({ phase: "error", error: "Microphone permission denied" }));
    act(() => h.patch({ transcripts: [{ itemId: "speech", role: "assistant", text: "last words", final: true }] }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Own chat" }));
    expect(h.toastError).toHaveBeenCalledExactlyOnceWith("Microphone permission denied");
  });

  it("removes controls only when the controller confirms the call is idle", () => {
    h.patch({ phase: "idle", runId: null });
    mount(destinations.Settings);
    expect(screen.queryByRole("region", { name: "Voice chat controls" })).toBeNull();
    act(() => h.patch({ phase: "connecting", runId: "voice" }));
    expect(screen.getByRole("region", { name: "Voice chat controls" })).toBeTruthy();
    act(() => h.patch({ phase: "idle", runId: null }));
    expect(screen.queryByRole("region", { name: "Voice chat controls" })).toBeNull();
    expect(h.voice.stop).not.toHaveBeenCalled();
  });

  it.each(["missing", "archived"])("keeps call controls when the source chat is %s", (kind) => {
    h.run = kind === "missing" ? null : { ...owner, isArchived: true };
    mount(destinations.Settings);
    expect((screen.getByRole("button", { name: "Return to voice chat" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "End voice chat" }));
    expect(h.voice.stop).toHaveBeenCalledOnce();
    expect(h.jump).not.toHaveBeenCalled();
  });

  it.each([destinations.Settings, destinations["Another chat"]])("shows the dock during a route transition even with stale chat presence (%s)", (path) => {
    const hide = voiceChatPresence.show("voice");
    try {
      mount(path);
      expect(screen.getByTestId("orb").dataset.size).toBe("compact");
      expect(h.voice.stop).not.toHaveBeenCalled();
    } finally { act(() => hide()); }
  });

  it("still stops on backend disconnection, backend replacement, unload and app shell disposal", () => {
    const view = mount(destinations.Settings);
    for (const listener of h.local.statusListeners) listener("connected");
    expect(h.voice.stop).not.toHaveBeenCalled();
    for (const listener of h.local.statusListeners) listener("disconnected");
    expect(h.voice.stop).toHaveBeenCalledTimes(1);
    h.active = h.remote;
    h.transportChange!();
    expect(h.voice.stop).toHaveBeenCalledTimes(2);
    expect(h.local.statusListeners.size).toBe(0);
    expect(h.remote.statusListeners.size).toBe(1);
    window.dispatchEvent(new Event("beforeunload"));
    expect(h.voice.stop).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(h.voice.stop).toHaveBeenCalledTimes(4);
    expect(h.transportChange).toBeUndefined();
    expect(h.remote.statusListeners.size).toBe(0);
    window.dispatchEvent(new Event("beforeunload"));
    expect(h.voice.stop).toHaveBeenCalledTimes(4);
  });
});
