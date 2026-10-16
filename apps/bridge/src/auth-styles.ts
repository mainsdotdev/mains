// Standalone counterpart of desktop index.css's default palette and glass
// controls. Keep auth pages independent of the renderer and external assets.
export const authStyles = `
  :root {
    color-scheme: light dark;
    --color-primary: #ffffff; --color-primary-50: #efeeee;
    --color-primary-100: #f7f7f6; --color-primary-200: #d3d3d3;
    --color-primary-300: #b5b5b5; --color-primary-400: #a09d95;
    --color-primary-500: #878580; --color-primary-600: #6f6e69;
    --color-primary-700: #575653; --color-primary-800: #262625;
    --color-primary-900: #141414; --color-primary-950: #0c0c0c;
    --color-action: #2563eb; --color-action-hover: #1d4ed8;
    --color-danger: #ff4436;
    --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --background: var(--color-primary-100); --foreground: var(--color-primary-900);
    --muted: var(--color-primary-600); --label: var(--color-primary-700);
    --glass-fill-card: var(--color-primary);
    --glass-fill-input: var(--color-primary);
    --glass-fill-button: var(--color-primary-100);
    --glass-hover-button: var(--color-primary-50);
    --glass-rim: color-mix(in srgb, var(--color-primary-950) 10%, transparent);
    --glass-edge: color-mix(in srgb, var(--color-primary) 55%, transparent);
    --error: color-mix(in srgb, var(--color-danger) 70%, var(--color-primary-950));
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: var(--color-primary-950); --foreground: var(--color-primary-100);
      --muted: var(--color-primary-300); --label: var(--color-primary-300);
      --glass-fill-card: var(--color-primary-900);
      --glass-fill-input: color-mix(in srgb, var(--color-primary-950) 75%, var(--color-primary-900));
      --glass-fill-button: color-mix(in srgb, var(--color-primary-800) 72%, var(--color-primary-900));
      --glass-hover-button: var(--color-primary-800);
      --glass-rim: color-mix(in srgb, var(--color-primary) 9%, transparent);
      --glass-edge: color-mix(in srgb, var(--color-primary) 12%, transparent);
      --error: color-mix(in srgb, var(--color-danger) 60%, var(--color-primary));
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; min-height: 100svh; padding: 48px 20px;
    display: grid; place-items: center; background: var(--background); color: var(--foreground);
    font: 14px/1.5 var(--font-sans); -webkit-font-smoothing: antialiased; font-optical-sizing: auto;
  }
  .auth-card {
    width: 100%; max-width: 432px; min-width: 0; padding: 32px;
    border: .5px solid var(--glass-rim); border-radius: 24px;
    background: var(--glass-fill-card);
    box-shadow: inset 0 .5px 0 var(--glass-edge);
  }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 30px; }
  .brand-mark { width: 25px; height: 25px; flex: none; }
  .brand-name { font-size: 17px; font-weight: 600; letter-spacing: -.04em; }
  .brand-product { margin-left: 2px; padding-left: 12px; border-left: 1px solid var(--glass-rim); color: var(--muted); font-size: 13px; }
  h1 { margin: 0 0 10px; font-size: 24px; line-height: 1.25; font-weight: 600; letter-spacing: -.035em; }
  p { margin: 0 0 24px; }
  .muted, .hint, .divider, .account-switch { color: var(--muted); }
  .hint { margin: 8px 0 0; font-size: 12px; line-height: 1.5; }
  .signed-in-account { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
  .signed-in-account strong { color: var(--foreground); font-weight: 500; }
  .field { margin: 0 0 18px; }
  label { display: block; margin-bottom: 7px; color: var(--label); font-size: 13px; font-weight: 500; }
  .field-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .field-heading a { font-size: 12px; }
  input {
    width: 100%; min-width: 0; min-height: 44px; padding: 10px 12px;
    border: .5px solid var(--glass-rim); border-radius: 12px; background: var(--glass-fill-input);
    color: var(--foreground); font: inherit; transition: border-color 150ms, outline-color 150ms;
  }
  input::placeholder { color: var(--muted); opacity: .8; }
  input:disabled { opacity: .55; cursor: not-allowed; }
  a { color: inherit; text-decoration: none; text-underline-offset: 3px; }
  a:hover { text-decoration: underline; }
  .button {
    display: inline-flex; align-items: center; justify-content: center; gap: 9px;
    width: 100%; min-height: 44px; padding: 11px 14px; border: .5px solid var(--glass-rim);
    border-radius: 12px; font: 500 13px/20px var(--font-sans); cursor: pointer;
    box-shadow: inset 0 .5px 0 var(--glass-edge);
    transition: background-color 150ms, border-color 150ms;
  }
  .button svg { width: 17px; height: 17px; flex: none; }
  .button-primary { background: var(--color-action); color: var(--color-primary); border-color: var(--color-action); }
  .button-primary:not(:disabled):hover { background: var(--color-action-hover); border-color: var(--color-action-hover); }
  .button-secondary { background: var(--glass-fill-button); color: var(--foreground); }
  .button-secondary:not(:disabled):hover { background: var(--glass-hover-button); }
  .button:disabled { cursor: wait; opacity: .5; }
  input:focus-visible, .button:focus-visible, a:focus-visible { outline: 2px solid var(--color-action); outline-offset: 3px; }
  .divider { display: flex; align-items: center; gap: 14px; margin: 22px 0; font-size: 12px; }
  .divider::before, .divider::after { content: ""; height: .5px; flex: 1; background: var(--glass-rim); }
  .account-switch { margin: 22px 0 0; text-align: center; font-size: 13px; }
  .account-switch a { color: var(--foreground); font-weight: 500; }
  .alternate { margin: 14px 0 0; text-align: center; font-size: 12px; color: var(--muted); }
  .actions { display: flex; gap: 10px; margin-top: 24px; }
  .actions .button { flex: 1; min-width: 0; }
  .code-input { min-height: 54px; font: 500 21px/1.4 ui-monospace, "SFMono-Regular", Consolas, monospace; letter-spacing: .2em; text-align: center; text-transform: uppercase; }
  .code-input::placeholder { font: 14px/1.5 var(--font-sans); letter-spacing: normal; text-transform: none; }
  #result { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; }
  #result:not(:empty) { margin-top: 20px; padding: 12px; border: .5px solid var(--glass-rim); border-radius: 12px; background: var(--glass-fill-input); }
  #result[data-error] { color: var(--error); }
  @media (max-width: 480px) { body { padding: 24px 16px; } .auth-card { padding: 26px 22px; } }
  @media (prefers-reduced-motion: reduce) { input, .button { transition: none; } }
  @media (forced-colors: active) { .auth-card, input, .button, #result:not(:empty) { border: 1px solid ButtonText; } .button-primary { background: ButtonFace; color: ButtonText; } }
`;
