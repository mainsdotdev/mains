// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppshotsStatus } from "../../../../shared/appshots";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { toast } from "@/components/ui";
import LensSettings from "./lens";
const status: AppshotsStatus = { supported: true, enabled: true, shortcut: "Command+Shift+Space", shortcutRegistered: true, screenPermission: "granted", accessibilityTrusted: false, capturing: false, lastError: null };
const api = { getStatus: vi.fn(), configure: vi.fn(), captureNow: vi.fn(), requestAccessibility: vi.fn(), openSystemSettings: vi.fn() };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((finish) => { resolve = finish; }); return { promise, resolve }; }
beforeEach(() => { for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ success: true, data: status }); vi.stubGlobal("api", { appshots: api }); vi.spyOn(toast, "error").mockImplementation(() => ""); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("does not overwrite a confirmed toggle with an older focus refresh", async () => {
  const refresh = deferred<ServiceResponse<AppshotsStatus>>();
  api.getStatus.mockResolvedValueOnce({ success: true, data: status }).mockReturnValueOnce(refresh.promise);
  api.configure.mockResolvedValueOnce({ success: true, data: { ...status, enabled: false, shortcutRegistered: false } });
  render(<LensSettings />);
  const toggle = await screen.findByRole("switch", { name: "Enable Lens window capture" });
  act(() => { window.dispatchEvent(new Event("focus")); });
  await act(async () => { fireEvent.click(toggle); });
  await act(async () => { refresh.resolve({ success: true, data: status }); });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
});

it("uses only the latest focus refresh when permission reads resolve out of order", async () => {
  const old = deferred<ServiceResponse<AppshotsStatus>>(), current = deferred<ServiceResponse<AppshotsStatus>>();
  api.getStatus.mockResolvedValueOnce({ success: true, data: status }).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<LensSettings />); await screen.findByRole("switch", { name: "Enable Lens window capture" });
  act(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
  await act(async () => { current.resolve({ success: true, data: { ...status, enabled: false } }); old.resolve({ success: true, data: status }); });
  expect(screen.getByRole("switch", { name: "Enable Lens window capture" }).getAttribute("aria-checked")).toBe("false");
});
it("admits a single test capture and ignores its failure after the view unmounts", async () => {
  const capture = deferred<ServiceResponse<unknown>>(); api.captureNow.mockReturnValueOnce(capture.promise);
  const view = render(<LensSettings />); const button = await screen.findByRole("button", { name: "Capture Window" });
  await act(async () => { fireEvent.click(button); fireEvent.click(button); }); expect(api.captureNow).toHaveBeenCalledOnce();
  view.unmount(); await act(async () => { capture.resolve({ success: false, error: "Obsolete capture" }); }); expect(toast.error).not.toHaveBeenCalled();
});
it("surfaces a rejected capture and releases the control for retry", async () => {
  api.captureNow.mockRejectedValueOnce(new Error("Capture unavailable"));
  render(<LensSettings />); const button = await screen.findByRole("button", { name: "Capture Window" });
  await act(async () => { fireEvent.click(button); }); expect(toast.error).toHaveBeenCalledWith("Capture unavailable");
  await act(async () => { fireEvent.click(button); }); expect(api.captureNow).toHaveBeenCalledTimes(2);
});
