import { randomToken } from "./identity";
import { authStyles } from "./auth-styles";

// Same mark as desktop's components/ui/icons/mains.tsx, rendered locally so
// account pages need no external images, fonts or scripts.
const mainsMark = `<svg class="brand-mark" aria-hidden="true" focusable="false" viewBox="0 0 720 674" fill="none"><path fill="currentColor" d="M126.667 57.286C200 177.378 270 230.752 360 230.752s160-53.374 233.333-173.466c13.334-20.015 30-23.35 43.334 0C690 130.676 720 224.08 720 337.5c0 113.42-30 206.824-83.333 280.214-13.334 23.351-30 20.015-43.334 0C520 497.622 450 444.248 360 444.248s-160 53.374-233.333 173.466c-13.334 20.015-30 23.351-43.334 0C30 544.324 0 450.92 0 337.5 0 224.08 30 130.676 83.333 57.286c13.334-23.35 30-20.015 43.334 0Z"/></svg>`;
const githubMark = `<svg aria-hidden="true" focusable="false" viewBox="0 0 20 20"><path fill="currentColor" fill-rule="evenodd" d="M10 0c5.523 0 10 4.59 10 10.253 0 4.529-2.862 8.371-6.833 9.728-.507.101-.687-.219-.687-.492 0-.338.012-1.442.012-2.814 0-.956-.32-1.58-.679-1.898 2.227-.254 4.567-1.121 4.567-5.059 0-1.12-.388-2.034-1.03-2.752.104-.259.447-1.302-.098-2.714 0 0-.838-.275-2.747 1.051A9.396 9.396 0 0 0 10 4.958a9.375 9.375 0 0 0-2.503.345C5.586 3.977 4.746 4.252 4.746 4.252c-.543 1.412-.2 2.455-.097 2.714-.639.718-1.03 1.632-1.03 2.752 0 3.928 2.335 4.808 4.556 5.067-.286.256-.545.708-.635 1.371-.57.262-2.018.715-2.91-.852 0 0-.529-.985-1.533-1.057 0 0-.975-.013-.068.623 0 0 .655.315 1.11 1.5 0 0 .587 1.83 3.369 1.21.005.857.014 1.665.014 1.909 0 .271-.184.588-.683.493C2.865 18.627 0 14.783 0 10.253 0 4.59 4.478 0 10 0"/></svg>`;

export function authPage(title: string, markup: string, script: string): Response {
  const nonce = randomToken();
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Mains</title>
    <style nonce="${nonce}">${authStyles}</style></head><body><main class="auth-card" aria-labelledby="page-title"><header class="brand">${mainsMark}<span class="brand-name">Mains</span><span class="brand-product">Bridge</span></header><h1 id="page-title">${title}</h1>${markup}<p id="result" role="status" aria-live="polite" aria-atomic="true"></p></main><script nonce="${nonce}">${script}</script></body></html>`, {
    headers: { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` },
  });
}
export const authClient = `const result=document.querySelector('#result');
  function message(text){result.textContent=text;result.removeAttribute('data-error');result.setAttribute('role','status');}
  function fail(error){result.textContent=error.message||'Sign-in is unavailable. Try again.';result.setAttribute('data-error','');result.setAttribute('role','alert');}
  async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok){const error=Error(r.status>=500?'Sign-in is unavailable. Try again.':data.message||data.error||'Sign-in failed');error.code=data.code;throw error;}return data;}
  function onSubmit(form,action){form.onsubmit=async event=>{event.preventDefault();if(form.dataset.busy)return;const data=new FormData(form);const controls=[...form.querySelectorAll('input,button')];form.dataset.busy='true';controls.forEach(control=>control.disabled=true);message('');try{await action(data);}catch(error){fail(error);}finally{form.querySelectorAll('input[type=password]').forEach(input=>input.value='');controls.forEach(control=>control.disabled=false);delete form.dataset.busy;}};}
  window.addEventListener('pagehide',()=>document.querySelectorAll('input[type=password]').forEach(input=>input.value=''));`;

const emailField = `<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" maxlength="254" required></div>`;
function passwordField(label = "Password", autocomplete = "current-password", minimum = false, forgotURL?: string) {
  return `<div class="field"><div class="field-heading"><label for="password">${label}</label>${forgotURL ? `<a href="${escapeAttribute(forgotURL)}">Forgot password?</a>` : ""}</div><input id="password" name="password" type="password" autocomplete="${autocomplete}" ${minimum ? 'minlength="12"' : ""} maxlength="128" required>${minimum ? '<p class="hint">Use at least 12 characters.</p>' : ""}</div>`;
}
function signInURL(next: string, mode = "sign-in") {
  return `/sign-in?${new URLSearchParams({ next, mode })}`;
}
const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const scriptJSON = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export function bridgeSignInPage(url: URL, next: string, methods: { github: boolean; email: boolean }): Response {
  const requestedMode = url.searchParams.get("mode");
  const mode = requestedMode === "create" || requestedMode === "forgot" || requestedMode === "link" ? requestedMode : "sign-in";
  const options = scriptJSON({ next, mode, verified: `${signInURL(next)}&verified=1`, reset: `/reset-password?${new URLSearchParams({ next })}` });
  const back = `<p class="account-switch"><a href="${escapeAttribute(signInURL(next))}">Back to sign in</a></p>`;
  if (!methods.email && mode !== "sign-in") return authPage("Email sign-in unavailable", `<p>Email sign-in has not been configured for this Bridge hub.</p>${back}`, "");
  const social = methods.github && (mode === "sign-in" || mode === "create") ? `<button id="github" class="button button-secondary" type="button">${githubMark}Continue with GitHub</button>${methods.email ? '<div class="divider">or continue with email</div>' : ""}` : "";
  let title = "Sign in", markup = `<p class="muted">Connect this device to your Mains account.</p>${social}`;
  if (mode === "create") {
    title = "Create your account";
    markup = `<p class="muted">One account for your connected devices.</p>${social}<form id="credentials"><div class="field"><label for="name">Name</label><input id="name" name="name" autocomplete="name" maxlength="128" required></div>${emailField}${passwordField("Password", "new-password", true)}<button type="submit" class="button button-primary">Create account</button></form>${back}`;
  } else if (mode === "forgot") {
    title = "Reset your password";
    markup = `<p class="muted">We’ll send you a link to set a new password.</p><form id="credentials">${emailField}<button type="submit" class="button button-primary">Send reset link</button></form><p class="hint">Signed up with GitHub? You can use this to add a password.</p>${back}`;
  } else if (mode === "link") {
    title = "Email a sign-in link";
    markup = `<p class="muted">Get a one-time sign-in link in your inbox.</p><form id="credentials">${emailField}<button type="submit" class="button button-primary">Send sign-in link</button></form>${back}`;
  } else if (methods.email) {
    markup += `<form id="credentials">${emailField}${passwordField("Password", "current-password", false, signInURL(next, "forgot"))}<button type="submit" class="button button-primary">Sign in</button></form>
      <p class="account-switch">New to Mains? <a href="${escapeAttribute(signInURL(next, "create"))}">Create an account</a></p>
      <p class="alternate"><a href="${escapeAttribute(signInURL(next, "link"))}">Email me a sign-in link</a></p>`;
  } else if (!methods.github) markup += '<p>Sign-in has not been configured for this Bridge hub.</p>';
  return authPage(title, markup, `${authClient}const options=${options};
    const github=document.querySelector('#github');if(github)github.onclick=async()=>{if(github.disabled)return;github.disabled=true;try{const data=await post('/api/auth/sign-in/social',{provider:'github',callbackURL:options.next});location.assign(data.url);}catch(error){fail(error);github.disabled=false;}};
    const form=document.querySelector('#credentials');if(form)onSubmit(form,async data=>{
      const email=data.get('email');
      if(options.mode==='create'){await post('/api/auth/sign-up/email',{name:data.get('name'),email,password:data.get('password'),callbackURL:options.verified});message('Check your email to verify your account. If you already have an account, sign in or reset your password.');}
      else if(options.mode==='forgot'){await post('/api/auth/request-password-reset',{email,redirectTo:new URL(options.reset,location.origin).href});message('If an account uses this email, a password reset link is on its way.');}
      else if(options.mode==='link'){await post('/api/auth/sign-in/magic-link',{email,callbackURL:options.next});message('Check your email for the sign-in link.');}
      else{await post('/api/auth/sign-in/email',{email,password:data.get('password'),callbackURL:options.next});location.assign(options.next);}
    });
    if(new URLSearchParams(location.search).get('verified')==='1')message('Email verified. Sign in to continue.');
    else if(new URLSearchParams(location.search).has('error'))fail(Error('This email link is invalid or expired. Sign in to request a new one.'));`);
}

export function bridgeResetPasswordPage(next: string, enabled: boolean): Response {
  const backURL = signInURL(next);
  const back = `<p class="account-switch"><a href="${escapeAttribute(backURL)}">Back to sign in</a></p>`;
  if (!enabled) return authPage("Password reset unavailable", `<p>Email sign-in has not been configured for this Bridge hub.</p>${back}`, "");
  return authPage("Set a new password", `<p class="muted">Choose a new password for your Mains account.</p>
    <form id="reset">${passwordField("New password", "new-password", true)}<div class="field"><label for="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div><button type="submit" class="button button-primary">Save password</button></form><p class="hint">Your recovery code and approved devices stay the same.</p>${back}`,
    `${authClient}const params=new URLSearchParams(location.search);const token=params.get('token');const invalid=!token||params.has('error');
    params.delete('token');params.delete('error');history.replaceState(null,'',location.pathname+(params.size?'?'+params:''));
    const form=document.querySelector('#reset');if(invalid){form.hidden=true;fail(Error('This reset link is invalid or expired. Request a new link from the sign-in page.'));}
    else onSubmit(form,async data=>{if(data.get('password')!==data.get('confirm'))throw Error('Passwords do not match.');await post('/api/auth/reset-password',{token,newPassword:data.get('password')});form.hidden=true;message('Password saved. Sign in to continue.');});`);
}
