import { bridgeBase64, bridgeBytes } from "@mains/contracts/bridge-auth";
import { bridgeAuth, digestToken, randomToken, signedInUser, type AuthEnv } from "./identity";
import { HttpError, json, jsonInput, rateLimit, textField } from "./auth-http";

function loopback(value: unknown): string {
  const uri = new URL(textField(value, "redirect URI", 256));
  if (uri.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(uri.hostname) || !uri.port || uri.pathname !== "/callback" || uri.search || uri.hash || uri.username || uri.password)
    throw new HttpError(400, "Use a loopback callback on this computer");
  return uri.toString();
}
function page(title: string, markup: string, script: string): Response {
  const nonce = randomToken();
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Mains</title>
    <style nonce="${nonce}">body{font:16px system-ui;background:#f5f5f3;color:#202321;max-width:440px;margin:12vh auto;padding:24px}h1{font-size:28px}button,input{font:inherit;padding:12px;border-radius:10px;border:1px solid #bcc3bc;width:100%;box-sizing:border-box;margin:8px 0}button{cursor:pointer;background:#e1f1e5}p{line-height:1.5}#result{white-space:pre-wrap}code{font-size:24px;letter-spacing:4px}</style>
    <main><p>Mains Bridge</p><h1>${title}</h1>${markup}<p id="result" role="status"></p></main><script nonce="${nonce}">${script}</script></html>`, {
      headers: { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` },
    });
}
const client = `const result=document.querySelector('#result'); async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.message||data.error||'Sign-in failed');return data;}function fail(error){result.textContent=error.message;}`;
function nextPath(raw: string | null) { return raw?.startsWith("/authorize?") || raw?.startsWith("/device") ? raw : "/device"; }
export async function handleSignIn(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (path.startsWith("/api/auth/")) return bridgeAuth(env, request).handler(request);
  if (!["/sign-in", "/device", "/authorize", "/v1/auth/authorize", "/v1/auth/exchange"].includes(path)) return null;
  try {
    if (path === "/sign-in" && request.method === "GET") {
      const next = nextPath(url.searchParams.get("next"));
      const options = JSON.stringify({ next, github: !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET, email: !!env.AUTH_MAILER || !!env.RESEND_API_KEY && !!env.MAIL_FROM }).replace(/</g, "\\u003c");
      return page("Sign in", `<p>Connect this backend to your Mains account.</p><button id="github">Continue with GitHub</button>
        <form id="email"><label>Email<input name="email" type="email" autocomplete="email" required></label><button>Send sign-in link</button></form>`,
        `${client}const options=${options};document.querySelector('#github').hidden=!options.github;document.querySelector('#email').hidden=!options.email;
        document.querySelector('#github').onclick=()=>post('/api/auth/sign-in/social',{provider:'github',callbackURL:options.next}).then(d=>location.assign(d.url)).catch(fail);
        document.querySelector('#email').onsubmit=e=>{e.preventDefault();post('/api/auth/sign-in/magic-link',{email:new FormData(e.target).get('email'),callbackURL:options.next}).then(()=>result.textContent='Check your email for the sign-in link.').catch(fail);};`);
    }
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
    if (!user) return Response.redirect(new URL(`/sign-in?next=${encodeURIComponent(path === "/v1/auth/authorize" ? "/device" : url.pathname + url.search)}`, url).toString(), 302);
    if (path === "/device" && request.method === "GET") {
      const code = (url.searchParams.get("user_code") ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
      return page("Authorize your backend", `<p>Enter the code shown by Mains. Approve only a backend you are signing into.</p><form id="device"><label>Sign-in code<input name="code" value="${code}" required autocomplete="off"></label><button>Authorize Mains backend</button><button type="button" id="deny">Cancel request</button></form>`,
        `${client}document.querySelector('#device').onsubmit=async e=>{e.preventDefault();try{const code=new FormData(e.target).get('code');const verified=await fetch('/api/auth/device?user_code='+encodeURIComponent(code));if(!verified.ok)throw Error('The sign-in code is invalid, expired or belongs to another account');await post('/api/auth/device/approve',{userCode:code});result.textContent='Signed in. Return to Mains to finish key approval.';}catch(error){fail(error);}};
        document.querySelector('#deny').onclick=async()=>{try{const code=document.querySelector('input').value;const verified=await fetch('/api/auth/device?user_code='+encodeURIComponent(code));if(!verified.ok)throw Error('Invalid or expired sign-in code');await post('/api/auth/device/deny',{userCode:code});result.textContent='Request cancelled.';}catch(error){fail(error);}};`);
    }
    if (path === "/authorize" && request.method === "GET") {
      loopback(url.searchParams.get("redirect_uri")); bridgeBytes(url.searchParams.get("code_challenge"), 32);
      const state = textField(url.searchParams.get("state"), "state");
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new HttpError(400, "Invalid sign-in state");
      const args = JSON.stringify({ redirectUri: url.searchParams.get("redirect_uri"), challenge: url.searchParams.get("code_challenge"), state }).replace(/</g, "\\u003c");
      return page("Sign in to Mains", "<p>Continue to the Mains app on this computer. Key approval is a separate step.</p><button id=\"continue\">Continue to Mains</button>",
        `${client}const button=document.querySelector('#continue');button.onclick=async()=>{button.disabled=true;try{const d=await post('/v1/auth/authorize',${args});location.assign(d.redirect);}catch(error){button.disabled=false;fail(error);}};`);
    }
    if (path === "/v1/auth/authorize" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin) throw new HttpError(403, "Sign-in origin does not match");
      await rateLimit(env, `native:${user.id}`, 20);
      const body = await jsonInput(request), redirect = loopback(body.redirectUri); bridgeBytes(body.challenge, 32);
      const state = textField(body.state, "state"), code = randomToken();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new HttpError(400, "Invalid sign-in state");
      await env.AUTH_DB!.prepare("INSERT INTO bridge_login_codes(code_hash,user_id,redirect_uri,challenge,expires_at) VALUES(?,?,?,?,?)")
        .bind(await digestToken(code), user.id, redirect, body.challenge, Date.now() + 60_000).run();
      const callback = new URL(redirect); callback.searchParams.set("code", code); callback.searchParams.set("state", state);
      return json({ redirect: callback.toString() });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) { return json({ error: error instanceof HttpError ? error.message : "Sign-in is unavailable" }, error instanceof HttpError ? error.status : 400); }
}
