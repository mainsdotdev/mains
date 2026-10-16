import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeMailConfigured, sendBridgeMail, type BridgeMailKind } from "../src/auth-mail";

afterEach(() => { vi.unstubAllGlobals(); });

describe("Resend authentication mail delivery", () => {
  it.each([
    ["sign-in", "Sign in to Mains Bridge", "five minutes"],
    ["verify-email", "Verify your Mains email", "one hour"],
    ["reset-password", "Reset your Mains password", "15 minutes"],
  ] as [BridgeMailKind, string, string][])("sends %s with the configured sender and the one-time link intact", async (kind, subject, expiry) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "local-mail-id" }));
    vi.stubGlobal("fetch", send);
    const env = { RESEND_API_KEY: "local-test-key", MAIL_FROM: "Mains <no-reply@auth.mains.dev>" };
    const message = { kind, to: "local-test@example.com", url: "https://bridge.example.com/api/auth/verify?token=local-only&callbackURL=%2Fdevice" };
    await sendBridgeMail(env, message);
    expect(send).toHaveBeenCalledTimes(1);
    const [endpoint, init] = send.mock.calls[0];
    expect(endpoint).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer local-test-key", "Content-Type": "application/json" } });
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ from: env.MAIL_FROM, to: [message.to], subject });
    expect(body.text).toContain(message.url);
    expect(body.text).toContain(`expires in ${expiry}`);
    expect(body).not.toHaveProperty("RESEND_API_KEY");
  });

  it("requires both sender and secret before enabling email sign-in", async () => {
    const send = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", send);
    for (const env of [{}, { MAIL_FROM: "Mains <no-reply@auth.mains.dev>" }, { RESEND_API_KEY: "local-test-key" }]) {
      expect(bridgeMailConfigured(env)).toBe(false);
      await expect(sendBridgeMail(env, { kind: "sign-in", to: "local-test@example.com", url: "https://bridge.example.com" }))
        .rejects.toThrow("Email sign-in is not configured");
    }
    expect(send).not.toHaveBeenCalled();
    expect(bridgeMailConfigured({ MAIL_FROM: "Mains <no-reply@auth.mains.dev>", RESEND_API_KEY: "local-test-key" })).toBe(true);
  });

  it.each([401, 403, 429, 500])("rejects provider status %s without exposing its response", async (status) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("Provider diagnostic containing private data", { status }));
    vi.stubGlobal("fetch", send);
    await expect(sendBridgeMail({ RESEND_API_KEY: "local-test-key", MAIL_FROM: "Mains <no-reply@auth.mains.dev>" }, {
      kind: "verify-email", to: "local-test@example.com", url: "https://bridge.example.com/verify?token=local-only",
    })).rejects.toThrow(/^Could not send the account email$/);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
