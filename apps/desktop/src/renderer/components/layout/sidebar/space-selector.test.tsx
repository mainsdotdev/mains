// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitInfo } from "../../../../shared/adapter.types";
import type { Space } from "../../../../shared/space";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ invoke: mocks.invoke }),
}));
import { baseApi } from "@/lib/redux/api/baseApi";
import { CHANNELS } from "@mains/contracts/channels";
import SpaceSelector from "./space-selector";

const spaces: Space[] = [
  {
    id: "claude-space",
    name: "Claude",
    providerId: "claude_code",
    icon: "icon:claude",
  },
  { id: "codex-space", name: "Codex", providerId: "codex", icon: "icon:codex" },
  {
    id: "copilot-space",
    name: "Copilot",
    providerId: "copilot_cli",
    icon: "icon:copilot",
  },
] as Space[];
const stores: ReturnType<typeof makeStore>[] = [];
function makeStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(baseApi.middleware),
  });
}
function renderSelector() {
  const store = makeStore();
  stores.push(store);
  const onSpaceChange = vi.fn();
  render(
    <Provider store={store}>
      <SpaceSelector
        spaces={spaces}
        activeSpaceId={spaces[0].id}
        onSpaceChange={onSpaceChange}
        orientation="vertical"
      />
    </Provider>,
  );
  return { onSpaceChange };
}
async function advance(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function hover(name: string) {
  fireEvent.mouseEnter(screen.getByRole("button", { name }));
  await advance();
  await advance(50);
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.invoke.mockReset().mockResolvedValue({ success: true, data: null });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  stores
    .splice(0)
    .forEach((store) => store.dispatch(baseApi.util.resetApiState()));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("space usage hover cards", () => {
  it("loads only after hovering and preserves space selection", async () => {
    const { onSpaceChange } = renderSelector();
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Claude" }));
    await advance(200);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await advance(100);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      CHANNELS.providers.getRateLimits,
      ["claude_code"],
    );
    expect(screen.getByRole("tooltip").id).toBe("space-usage-claude-space");
    fireEvent.click(screen.getByRole("button", { name: "Claude" }));
    await advance();
    expect(onSpaceChange).toHaveBeenCalledWith("claude-space");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows a loading state, then Claude windows with remaining quotas and reset times", async () => {
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderSelector();
    await hover("Claude");
    expect(screen.getByRole("status").textContent).toBe(
      "Loading usage limits…",
    );
    const limits: RateLimitInfo = {
      primary: {
        label: "Current session",
        usedPercent: 25,
        resetsAt: 1900000000,
      },
      secondary: { label: "Weekly", usedPercent: 80 },
    };
    await act(async () => {
      resolve({ success: true, data: limits });
    });
    await advance(50);
    expect(screen.getByText("75% left")).toBeTruthy();
    expect(screen.getByText("20% left")).toBeTruthy();
    expect(screen.getByText(/^Resets /)).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "Current session" })
        .getAttribute("aria-valuenow"),
    ).toBe("75");
  });

  it("uses the hovered provider and retains separate Codex allowance buckets", async () => {
    mocks.invoke.mockResolvedValue({
      success: true,
      data: {
        rateLimitsByLimitId: {
          codex: { primary: { usedPercent: 30, windowDurationMins: 300 } },
          base_model_inference: {
            secondary: { usedPercent: 15, windowDurationMins: 10080 },
          },
        },
      },
    });
    renderSelector();
    await hover("Codex");
    expect(mocks.invoke).toHaveBeenCalledWith(
      CHANNELS.providers.getRateLimits,
      ["codex"],
    );
    const card = within(screen.getByRole("tooltip"));
    expect(card.getByText("Advanced usage")).toBeTruthy();
    expect(card.getByText("Model Reserve")).toBeTruthy();
    expect(card.getByText("5 hour usage limit")).toBeTruthy();
    expect(card.getByText("Weekly usage limit")).toBeTruthy();
    expect(card.getByText("70% left")).toBeTruthy();
    expect(card.getByText("85% left")).toBeTruthy();
  });

  it("shows remaining Copilot counts and clamps exhausted quotas", async () => {
    mocks.invoke.mockResolvedValue({
      success: true,
      data: {
        primary: {
          label: "Premium requests",
          usedPercent: 120,
          used: 240,
          total: 200,
        },
      },
    });
    renderSelector();
    await hover("Copilot");
    expect(screen.getByText("0% left")).toBeTruthy();
    expect(screen.getByText("0 / 200 left")).toBeTruthy();
  });

  it.each([
    [{ success: true, data: null }, "No usage data available"],
    [{ success: false, error: "Unavailable" }, "Couldn’t load usage limits"],
  ])(
    "distinguishes missing data and failed requests",
    async (response, message) => {
      mocks.invoke.mockResolvedValue(response);
      renderSelector();
      await hover("Claude");
      expect(screen.getByRole("status").textContent).toBe(message);
      expect(screen.queryByRole("progressbar")).toBeNull();
    },
  );

  it("supports focus and Escape and reuses recent data on the next hover", async () => {
    renderSelector();
    const button = screen.getByRole("button", { name: "Claude" });
    fireEvent.focus(button);
    await advance();
    expect(button.getAttribute("aria-describedby")).toBe(
      screen.getByRole("tooltip").id,
    );
    fireEvent.keyDown(button, { key: "Escape" });
    await advance();
    expect(screen.queryByRole("tooltip")).toBeNull();
    await hover("Claude");
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
