import { authPage, authClient } from "./auth-page";
import { BRIDGE_ACCESS_UNAVAILABLE, type BridgeAccess } from "./beta";

/** Called only after verified sign-in. The public sign-in forms never advertise
 * beta, and an unavailable account receives no invitation copy or action. */
export function bridgeAccessPage(access: BridgeAccess, next: string, email: string): Response | null {
  if (access === "allowed") return null;
  const signIn = `/sign-in?${new URLSearchParams({ next })}`;
  const switchAccount = `<button type="button" id="switch" class="button button-secondary">Use another account</button>`;
  const switchScript = `${authClient}document.querySelector('#switch').onclick=async()=>{try{await post('/api/auth/sign-out',{});location.assign(${JSON.stringify(signIn).replace(/</g, "\\u003c")});}catch(error){fail(error);}};`;
  if (access !== "invited") {
    const accountEmail = email.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return authPage("Bridge access unavailable", `<p class="muted">${BRIDGE_ACCESS_UNAVAILABLE}</p><p class="signed-in-account">Signed in as <strong>${accountEmail}</strong></p>${switchAccount}<p class="hint">You can close this window and return to Mains.</p>`, switchScript);
  }
  return authPage("You’re invited to Bridge", `<p class="muted">Activate your beta access to sync your chats and Atlas across devices.</p>
    <p>Your 30 days start when you activate. Includes 1 GiB of storage. No payment required.</p>
    <form id="activate"><div class="actions">${switchAccount}<button type="submit" class="button button-primary">Activate beta</button></div></form>`,
    `${switchScript}onSubmit(document.querySelector('#activate'),async()=>{const data=await post('/v1/beta/activate',{next:${JSON.stringify(next).replace(/</g, "\\u003c")}});location.assign(data.redirect);});`);
}
