import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeEvent } from "./event-subscriptions";
import { resetTransport, setTransport } from "./registry";
import type { Transport } from "./types";

function fakeTransport(kind = "fake"): Transport {
  return {
    kind,
    invoke: vi.fn(),
    // each call returns a distinct unsubscribe spy (grab via mock.results)
    subscribe: vi.fn(() => vi.fn()),
    status: () => "connected",
    onStatusChange: () => () => {},
  };
}

describe("subscribeEvent", () => {
  afterEach(() => {
    resetTransport();
  });

  it("subscribes the listener on the active transport", () => {
    const t = fakeTransport();
    setTransport(t);
    const listener = vi.fn();

    const off = subscribeEvent("runs:ephemeralEvent", listener);

    expect(t.subscribe).toHaveBeenCalledWith("runs:ephemeralEvent", listener);
    off();
  });

  it("unsubscribe stops delivery and clears the subscription", () => {
    const t = fakeTransport();
    setTransport(t);
    const off = subscribeEvent("a:b", vi.fn());
    const innerOff = (t.subscribe as ReturnType<typeof vi.fn>).mock.results[0]
      .value as ReturnType<typeof vi.fn>;

    off();

    expect(innerOff).toHaveBeenCalledOnce();
  });

  it("re-binds live subscriptions when the transport changes", () => {
    const t1 = fakeTransport("t1");
    setTransport(t1);
    const listener = vi.fn();
    const off = subscribeEvent("a:b", listener);
    const t1Off = (t1.subscribe as ReturnType<typeof vi.fn>).mock.results[0]
      .value as ReturnType<typeof vi.fn>;

    const t2 = fakeTransport("t2");
    setTransport(t2);

    expect(t1Off).toHaveBeenCalledOnce(); // unbound from the old transport
    expect(t2.subscribe).toHaveBeenCalledWith("a:b", listener); // re-bound to the new one
    off();
  });

  it("does not re-bind a subscription after it is unsubscribed", () => {
    const t1 = fakeTransport("t1");
    setTransport(t1);
    const off = subscribeEvent("a:b", vi.fn());
    off();

    const t2 = fakeTransport("t2");
    setTransport(t2);

    expect(t2.subscribe).not.toHaveBeenCalled();
  });
});
