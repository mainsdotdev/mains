// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "@/lib/redux/api/baseApi";
import { pulseApi, type Pulse } from "@/lib/redux/api/pulseApi";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import PulsePage from "./Pulse";

vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ mode: "developer" }) }));
vi.mock("@/features/pulse/components/pulse-modal", () => ({ PulseModal: () => null }));

const pulse: Pulse = {
  id: "pulse-1",
  accountId: "account-1",
  workspaceId: null,
  collectionId: null,
  mode: "developer",
  providerId: "codex",
  model: "test-model",
  title: "Review the weekly report",
  prompt: "Summarize the report",
  frequency: "daily",
  dayOfWeek: null,
  hour: 9,
  minute: 0,
  timezone: "UTC",
  thinkingMode: false,
  effortLevel: null,
  isActive: false,
  lastRunAt: null,
  nextRunAt: null,
  lastRunId: null,
  lastError: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

type PulseRead = Awaited<ReturnType<Transport["invoke"]>>;
const listPulses = vi.fn<() => Promise<PulseRead>>();
const loadError = { success: false, error: "Test read failure" } as const;

function deferRead() {
  let resolve!: (result: PulseRead) => void;
  const promise = new Promise<PulseRead>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function createStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (defaults) => defaults().concat(baseApi.middleware),
  });
}

let store: ReturnType<typeof createStore>;

beforeEach(() => {
  listPulses.mockReset();
  store = createStore();
  setTransport({
    kind: "test",
    invoke: async (channel) => channel === CHANNELS.pulse.getAll
      ? listPulses()
      : { success: true, data: channel === CHANNELS.account.get ? null : [] },
    status: () => "connected",
    subscribe: () => () => {},
    onStatusChange: () => () => {},
  });
});

afterEach(() => {
  cleanup();
  store.dispatch(baseApi.util.resetApiState());
  resetTransport();
});

function renderPage() {
  return render(<Provider store={store}><MemoryRouter><PulsePage /></MemoryRouter></Provider>);
}

it("shows a load error, then displays the empty state after a successful retry", async () => {
  const initial = deferRead();
  listPulses.mockReturnValueOnce(initial.promise).mockResolvedValueOnce({ success: true, data: [] });
  renderPage();

  expect(screen.getByRole("status").textContent).toBe("Loading…");
  expect(screen.queryByText("Nothing scheduled yet")).toBeNull();
  await act(async () => initial.resolve(loadError));
  expect((await screen.findByRole("alert")).textContent).toBe("Unable to load pulses.");
  expect(screen.queryByText("Nothing scheduled yet")).toBeNull();
  expect(screen.getByText("Suggestions")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Nothing scheduled yet")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(listPulses).toHaveBeenCalledTimes(2);
});

it("keeps previously loaded pulses visible during and after a failed refresh", async () => {
  const refresh = deferRead();
  listPulses
    .mockResolvedValueOnce({ success: true, data: [pulse] })
    .mockReturnValueOnce(refresh.promise)
    .mockResolvedValueOnce({ success: true, data: [{ ...pulse, title: "Updated report" }] });
  renderPage();
  expect(await screen.findByText(pulse.title)).toBeTruthy();

  act(() => {
    void store.dispatch(pulseApi.endpoints.getPulses.initiate(undefined, { forceRefetch: true, subscribe: false }));
  });
  expect(screen.getByText(pulse.title)).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => refresh.resolve(loadError));
  expect((await screen.findByRole("alert")).textContent).toContain("Unable to refresh pulses.");
  expect(screen.getByText(pulse.title)).toBeTruthy();
  expect(screen.queryByText("Nothing scheduled yet")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Updated report")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps the load error and retry available while searching", async () => {
  listPulses.mockResolvedValueOnce(loadError);
  renderPage();
  await screen.findByRole("alert");
  fireEvent.change(screen.getByRole("textbox", { name: "Search pulses and suggestions" }), { target: { value: "unmatched" } });

  expect(screen.getByRole("alert").textContent).toBe("Unable to load pulses.");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.queryByText(/Nothing matches/)).toBeNull();
});
