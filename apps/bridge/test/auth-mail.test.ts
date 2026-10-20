import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeMailConfigured, MAINS_DOWNLOAD_URL, sendBridgeMail, type BridgeMailKind } from "../src/auth-mail";
import { MAINS_LOGO_CID, renderBridgeMail } from "../src/mail-template";

afterEach(() => { vi.unstubAllGlobals(); });
/** No remote images, fonts, stylesheets, scripts or tracking: an account email loads nothing, and its one
 * image is the logo attached to the message itself. */
function expectSelfContained(html: string) {
  expect(html).not.toMatch(/<script|<link|<iframe|url\(|@import|@font-face/i);
  expect(html.match(/<img\b[^>]*>/gi)).toEqual([expect.stringContaining(`src="cid:${MAINS_LOGO_CID}"`)]);
  expect(html).not.toMatch(/\bsrc="(?!cid:)/i);
  // Every attribute value closes where it should: a stray quote inside one would drop the rest of its styles.
  expect(html).not.toMatch(/\b[a-z-]+="[^"]*"[^\s>/]/i);
}

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
    // The branded HTML carries the same link, escaped, on its button and as visible text.
    const href = message.url.replace(/&/g, "&amp;");
    expect(body.html.split(`href="${href}"`)).toHaveLength(3);
    expect(body.html).toContain(`>${href}</a>`);
    for (const part of [">Mains</p>", ">Bridge</p>", 'alt="Mains"', `expires in ${expiry}`, "prefers-color-scheme: dark",
      'href="https://docs.mains.dev"', 'href="https://mains.dev/changelog"', 'href="https://mains.dev/support"']) expect(body.html).toContain(part);
    expectSelfContained(body.html);
    // The logo travels as an inline attachment the HTML names by its content id.
    expect(body.attachments).toEqual([{ filename: "mains.png", content_id: MAINS_LOGO_CID, content: expect.any(String) }]);
    expect(Buffer.from(body.attachments[0].content, "base64").subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("escapes every value it places in HTML and puts only HTTP(S) links on a button", () => {
    const invite = renderBridgeMail({ kind: "beta-invite", to: `x"><script>alert(1)</script>@example.com` });
    expect(invite.html).not.toContain("<script>");
    expect(invite.html).toContain("x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;@example.com");
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "//bridge.example.com/verify"])
      expect(() => renderBridgeMail({ kind: "sign-in", to: "a@example.com", url })).toThrow(/HTTP\(S\)/);
  });

  it("sends the beta invitation as plain steps without any sign-in link", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "local-mail-id" }));
    vi.stubGlobal("fetch", send);
    await sendBridgeMail({ RESEND_API_KEY: "local-test-key", MAIL_FROM: "Mains <no-reply@auth.mains.dev>" }, { kind: "beta-invite", to: "invited+alias@example.com" });
    const body = JSON.parse(send.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ to: ["invited+alias@example.com"], subject: "You're invited to the Mains Bridge beta" });
    for (const part of [MAINS_DOWNLOAD_URL, "(invited+alias@example.com)", "Activate beta", "Your 30 days start when you activate"]) expect(body.text).toContain(part);
    expect(body.text).not.toMatch(/token|expires in|\/api\/auth/);
    for (const part of ["You&#39;re invited to Bridge", "<strong>invited+alias@example.com</strong>", "<strong>Activate beta</strong>", `href="${MAINS_DOWNLOAD_URL}"`, "Get Mains"])
      expect(body.html).toContain(part);
    expect(body.html).not.toMatch(/token|expires in|\/api\/auth/);
    expectSelfContained(body.html);
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
