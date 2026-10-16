import { bridgeBase64, bridgeBytes } from "@mains/contracts/bridge-auth";
import { bridgeAuth, digestToken, randomToken, signedInUser, type AuthEnv } from "./identity";
import { HttpError, json, jsonInput, rateLimit, textField } from "./auth-http";
import { reportBridgeFailure } from "./observability";
import { bridgeMailConfigured } from "./auth-mail";
import { authPage as page, authClient as client, bridgeSignInPage, bridgeResetPasswordPage } from "./auth-page";
import { activateBridgeBeta, bridgeAccess, requireBridgeAccess } from "./beta";
import { bridgeAccessPage } from "./beta-page";

function loopback(value: unknown): string {
  const uri = new URL(textField(value, "redirect URI", 256));
  if (uri.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(uri.hostname) || !uri.port || uri.pathname !== "/callback" || uri.search || uri.hash || uri.username || uri.password)
    throw new HttpError(400, "Use a loopback callback on this computer");
  return uri.toString();
}
function nextPath(raw: string | null) { return raw?.startsWith("/authorize?") || raw === "/device" || raw?.startsWith("/device?") ? raw : "/device"; }
export async function handleSignIn(request: Request, env: AuthEnv, subscriptionChanged: (accountId: string) => Promise<void>): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (!path.startsWith("/api/auth/") && !["/sign-in", "/reset-password", "/device", "/authorize", "/v1/auth/authorize", "/v1/auth/exchange", "/v1/beta/activate"].includes(path)) return null;
  try {
    if (path.startsWith("/api/auth/")) {
      // Better Auth's device approval endpoint must enforce the same gate as
      // the browser page. Identity registration/login themselves remain public.
      if (path === "/api/auth/device/approve" && request.method === "POST") {
        const user = await signedInUser(env, request);
        if (!user) throw new HttpError(401, "Sign in first");
        await requireBridgeAccess(env, user);
      }
      return await bridgeAuth(env, request).handler(request);
    }
    if (path === "/sign-in" && request.method === "GET") {
      return bridgeSignInPage(url, nextPath(url.searchParams.get("next")), { github: !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET, email: bridgeMailConfigured(env) });
    }
    if (path === "/reset-password" && request.method === "GET") return bridgeResetPasswordPage(nextPath(url.searchParams.get("next")), bridgeMailConfigured(env));
    if (path === "/v1/auth/exchange" && request.method === "POST") {
      const body = await jsonInput(request), verifier = textField(body.verifier, "PKCE verifier", 128), redirect = loopback(body.redirectUri);
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new HttpError(400, "Invalid PKCE verifier");
      const challenge = bridgeBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      const code = textField(body.code, "authorization code");
      const row = await env.AUTH_DB!.prepare("DELETE FROM bridge_login_codes WHERE code_hash=? AND redirect_uri=? AND challenge=? AND expires_at>? RETURNING user_id")
        .bind(await digestToken(code), redirect, challenge, Date.now()).first<{ user_id: string }>();
      if (!row) throw new HttpError(401, "Sign-in code expired or PKCE verification failed");
      const context = await bridgeAuth(env, request).$context;
      const session = await context.internalAdapter.createSession(row.user_id);
      return json({ token: session.token });
    }
    const user = await signedInUser(env, request);
    if (path === "/v1/beta/activate") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      if (!user) throw new HttpError(401, "Sign in first");
      if (request.headers.get("Origin") !== url.origin) throw new HttpError(403, "Sign-in origin does not match");
      await rateLimit(env, `beta-activate:${user.id}`, 20);
      const body = await jsonInput(request);
      const invite = await activateBridgeBeta(env, user);
      // Invalidate a cached 'none' before returning to the app. A retry after
      // an interrupted response returns the same grant and invalidates again.
      await subscriptionChanged(user.id);
      return json({ startsAt: new Date(invite.activated_at!).toISOString(), expiresAt: new Date(invite.expires_at!).toISOString(), redirect: nextPath(typeof body.next === "string" ? body.next : null) });
    }
    if (!user) return Response.redirect(new URL(`/sign-in?next=${encodeURIComponent(path === "/v1/auth/authorize" ? "/device" : url.pathname + url.search)}`, url).toString(), 302);
    if (path === "/device" && request.method === "GET") {
      const gate = bridgeAccessPage(await bridgeAccess(env, user), url.pathname + url.search, user.email);
      if (gate) return gate;
      const code = (url.searchParams.get("user_code") ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
      return page("Authorize your device", `<p class="muted" id="device-description">Enter the code shown in Mains to connect your device. Only approve a sign-in you started.</p><form id="device"><div class="field"><label for="device-code">Sign-in code</label><input id="device-code" class="code-input" name="code" value="${code}" placeholder="Enter your code" required autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" aria-describedby="device-description"></div><div class="actions"><button type="button" id="deny" class="button button-secondary">Cancel</button><button type="submit" class="button button-primary">Authorize device</button></div></form>`,
        `${client}document.querySelector('#device').onsubmit=async e=>{e.preventDefault();try{const code=new FormData(e.target).get('code');const verified=await fetch('/api/auth/device?user_code='+encodeURIComponent(code));if(!verified.ok)throw Error('The sign-in code is invalid, expired or belongs to another account');await post('/api/auth/device/approve',{userCode:code});result.textContent='Signed in. Return to Mains to finish key approval.';}catch(error){fail(error);}};
        document.querySelector('#deny').onclick=async()=>{try{const code=document.querySelector('input').value;const verified=await fetch('/api/auth/device?user_code='+encodeURIComponent(code));if(!verified.ok)throw Error('Invalid or expired sign-in code');await post('/api/auth/device/deny',{userCode:code});result.textContent='Request cancelled.';}catch(error){fail(error);}};`);
    }
    if (path === "/authorize" && request.method === "GET") {
      loopback(url.searchParams.get("redirect_uri")); bridgeBytes(url.searchParams.get("code_challenge"), 32);
      const state = textField(url.searchParams.get("state"), "state");
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new HttpError(400, "Invalid sign-in state");
      const gate = bridgeAccessPage(await bridgeAccess(env, user), url.pathname + url.search, user.email);
      if (gate) return gate;
      const args = JSON.stringify({ redirectUri: url.searchParams.get("redirect_uri"), challenge: url.searchParams.get("code_challenge"), state }).replace(/</g, "\\u003c");
      return page("Sign in to Mains", "<p class=\"muted\">Continue to the Mains app on this computer to finish connecting your device.</p><button id=\"continue\" type=\"button\" class=\"button button-primary\">Continue to Mains</button>",
        `${client}const button=document.querySelector('#continue');button.onclick=async()=>{button.disabled=true;try{const d=await post('/v1/auth/authorize',${args});location.assign(d.redirect);}catch(error){button.disabled=false;fail(error);}};`);
    }
    if (path === "/v1/auth/authorize" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin) throw new HttpError(403, "Sign-in origin does not match");
      await rateLimit(env, `native:${user.id}`, 20);
      const body = await jsonInput(request), redirect = loopback(body.redirectUri); bridgeBytes(body.challenge, 32);
      const state = textField(body.state, "state"), code = randomToken();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new HttpError(400, "Invalid sign-in state");
      await requireBridgeAccess(env, user);
      await env.AUTH_DB!.prepare("INSERT INTO bridge_login_codes(code_hash,user_id,redirect_uri,challenge,expires_at) VALUES(?,?,?,?,?)")
        .bind(await digestToken(code), user.id, redirect, body.challenge, Date.now() + 60_000).run();
      const callback = new URL(redirect); callback.searchParams.set("code", code); callback.searchParams.set("state", state);
      return json({ redirect: callback.toString() });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (!(error instanceof HttpError)) reportBridgeFailure(env, "auth", 400);
    return json({ error: error instanceof HttpError ? error.message : "Sign-in is unavailable" }, error instanceof HttpError ? error.status : 400);
  }
}
