import { describe, expect, it } from "vitest";
import {
  buildSubprotocols,
  decodeWsMessage,
  encodeWsMessage,
  extractToken,
  parseProtocolHeader,
  type WsMessage,
} from "./ws-protocol";

describe("ws-protocol pairing-token subprotocols", () => {
  it("builds subprotocols with and without a token", () => {
    expect(buildSubprotocols()).toEqual(["mains.v1"]);
    expect(buildSubprotocols("tok")).toEqual(["mains.v1", "mains.token.tok"]);
  });

  it("extracts the token from offered subprotocols", () => {
    expect(extractToken(["mains.v1", "mains.token.tok"])).toBe("tok");
    expect(extractToken(["mains.v1"])).toBeNull();
  });

  it("parses the Sec-WebSocket-Protocol header", () => {
    expect(parseProtocolHeader("mains.v1, mains.token.tok")).toEqual([
      "mains.v1",
      "mains.token.tok",
    ]);
    expect(parseProtocolHeader(undefined)).toEqual([]);
  });
});

describe("ws-protocol", () => {
  it("round-trips invoke / response / event messages", () => {
    const messages: WsMessage[] = [
      { kind: "invoke", id: 1, channel: "runs:execute", args: [{ a: 1 }] },
      { kind: "response", id: 1, result: { success: true, data: 42 } },
      { kind: "event", channel: "runs:ephemeralEvent", payload: { x: 1 } },
    ];
    for (const message of messages) {
      expect(decodeWsMessage(encodeWsMessage(message))).toEqual(message);
    }
  });

  it("preserves the ServiceResponse envelope on the wire", () => {
    const decoded = decodeWsMessage(
      encodeWsMessage({
        kind: "response",
        id: 7,
        result: { success: false, error: "boom" },
      }),
    );
    expect(decoded).toEqual({
      kind: "response",
      id: 7,
      result: { success: false, error: "boom" },
    });
  });

  it("preserves Date values across encode/decode (structured-clone parity)", () => {
    const created = new Date("2026-06-18T12:34:56.000Z");
    const decoded = decodeWsMessage(
      encodeWsMessage({
        kind: "response",
        id: 1,
        result: { success: true, data: { createdAt: created, nested: [created] } },
      }),
    ) as { result: { data: { createdAt: unknown; nested: unknown[] } } };

    expect(decoded.result.data.createdAt).toBeInstanceOf(Date);
    expect((decoded.result.data.createdAt as Date).toISOString()).toBe(
      created.toISOString(),
    );
    expect(decoded.result.data.nested[0]).toBeInstanceOf(Date);
  });

  it("preserves undefined invoke args (so optional-arg defaults still fire, unlike raw JSON→null)", () => {
    const decoded = decodeWsMessage(
      encodeWsMessage({
        kind: "invoke",
        id: 3,
        channel: "workspace:listActivity",
        args: ["ws-1", undefined],
      }),
    ) as { args: unknown[] };
    expect(decoded.args[0]).toBe("ws-1");
    expect(decoded.args[1]).toBeUndefined();
    // Raw JSON.stringify would have coerced the undefined element to null,
    // which skips the backend parameter default (e.g. `.limit(limit ?? 50)`).
    expect(decoded.args[1]).not.toBeNull();
  });

  it("does not revive a plain object that merely has a $date-like field among others", () => {
    const decoded = decodeWsMessage(
      encodeWsMessage({
        kind: "event",
        channel: "x:y",
        payload: { $date: "not-alone", other: 1 },
      }),
    ) as { payload: Record<string, unknown> };
    expect(decoded.payload.$date).toBe("not-alone");
    expect(decoded.payload).not.toBeInstanceOf(Date);
  });

  it("throws on invalid JSON", () => {
    expect(() => decodeWsMessage("{not json")).toThrow();
  });

  it("throws when kind is missing", () => {
    expect(() => decodeWsMessage(JSON.stringify({ id: 1 }))).toThrow(/kind/);
  });

  it("throws on an unknown kind", () => {
    expect(() => decodeWsMessage(JSON.stringify({ kind: "nope" }))).toThrow(
      /unknown kind/,
    );
  });
});
