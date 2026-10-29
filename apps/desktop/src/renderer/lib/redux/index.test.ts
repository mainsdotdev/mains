// @vitest-environment jsdom
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { ok } from "@mains/contracts/service-response";
import { resetTransport, setTransport } from "../transport";
import { baseApi } from "./api/baseApi";
import { appSettingsApi, type AppSettings } from "./api/appSettingsApi";
import { persistor, store } from "./index";

let settings: AppSettings;
const invoke = vi.fn(async () => ok(settings));

beforeEach(() => {
  settings = {
    id: "settings", accountId: "account", activeSpaceId: "before",
    enableWorktrees: false, showToolCalls: true, preventSleepDuringRuns: false,
    notifyOnRunComplete: false, notifyOnToolApproval: false, showMenuBarIcon: false,
    commitInstructions: "", prInstructions: "", createdAt: 0, updatedAt: 0,
  };
  invoke.mockClear();
  setTransport({
    kind: "test", invoke,
    subscribe: () => () => {},
    status: () => "connected",
    onStatusChange: () => () => {},
  });
});

afterEach(() => {
  store.dispatch(baseApi.util.resetApiState());
  resetTransport();
  vi.restoreAllMocks();
});

afterAll(() => {
  persistor.pause();
});

describe("renderer cache refresh", () => {
  it.each(["focus", "visibilitychange", "online"])(
    "refreshes subscribed data after %s",
    async (event) => {
      const subscription = store.dispatch(appSettingsApi.endpoints.getAppSettings.initiate());
      await subscription.unwrap();
      expect(appSettingsApi.endpoints.getAppSettings.select()(store.getState()).data?.activeSpaceId).toBe("before");

      settings = { ...settings, activeSpaceId: "after", updatedAt: 1 };
      if (event === "visibilitychange") vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      if (event === "online") window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event(event));

      await vi.waitFor(() => {
        expect(appSettingsApi.endpoints.getAppSettings.select()(store.getState()).data?.activeSpaceId).toBe("after");
      });
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke).toHaveBeenLastCalledWith(CHANNELS.appSettings.get, []);
      subscription.unsubscribe();
    },
  );

  it("does not fetch unused cached queries when focus or connectivity returns", async () => {
    const subscription = store.dispatch(appSettingsApi.endpoints.getAppSettings.initiate());
    await subscription.unwrap();
    subscription.unsubscribe();

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
