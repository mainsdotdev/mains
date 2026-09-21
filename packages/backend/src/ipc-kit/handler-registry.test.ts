import { afterEach, describe, expect, it } from "vitest";
import {
  clearHandlers,
  hasHandler,
  invokeHandler,
  registerHandler,
  registeredChannels,
  unregisterHandler,
} from "./handler-registry";

describe("handler-registry", () => {
  afterEach(() => {
    clearHandlers();
  });

  it("invokes a handler with ctx first, then positional args", async () => {
    registerHandler("entities:update", async (ctx, id, payload) => ({
      success: true,
      data: { ctx, id, payload },
    }));

    const result = await invokeHandler("entities:update", ["e1", { a: 1 }], {
      clientId: "c1",
    });

    expect(result).toEqual({
      success: true,
      data: { ctx: { clientId: "c1" }, id: "e1", payload: { a: 1 } },
    });
  });

  it("defaults ctx to an empty object", async () => {
    registerHandler("a:b", async (ctx) => ({ success: true, data: ctx }));
    expect(await invokeHandler("a:b", [])).toEqual({ success: true, data: {} });
  });

  it("returns a failure for an unknown channel", async () => {
    expect(await invokeHandler("nope:missing", [])).toEqual({
      success: false,
      error: 'No handler registered for channel "nope:missing"',
    });
  });

  it("converts a thrown handler into a failure response", async () => {
    registerHandler("x:y", () => {
      throw new Error("kaboom");
    });
    expect(await invokeHandler("x:y", [])).toEqual({
      success: false,
      error: "kaboom",
    });
  });

  it("tracks and removes handlers", () => {
    registerHandler("a:b", async () => ({ success: true, data: 1 }));
    expect(hasHandler("a:b")).toBe(true);
    unregisterHandler("a:b");
    expect(hasHandler("a:b")).toBe(false);
  });

  it("lists registered channels", () => {
    expect(registeredChannels()).toEqual([]);
    registerHandler("runs:list", async () => ({ success: true, data: 1 }));
    registerHandler("workspace:get", async () => ({ success: true, data: 1 }));
    expect(registeredChannels().sort()).toEqual(["runs:list", "workspace:get"]);
    unregisterHandler("runs:list");
    expect(registeredChannels()).toEqual(["workspace:get"]);
  });

  it("clearHandlers empties the registry", () => {
    registerHandler("a:b", async () => ({ success: true, data: 1 }));
    registerHandler("c:d", async () => ({ success: true, data: 1 }));
    clearHandlers();
    expect(hasHandler("a:b")).toBe(false);
    expect(hasHandler("c:d")).toBe(false);
  });
});
