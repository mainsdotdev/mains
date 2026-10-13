import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let integrationDirectory: string | undefined;

// Source the user's startup files from their original ZDOTDIR, then install
// hooks in this shell only. No user dotfiles are changed.
function shellDirectory(): string {
  if (integrationDirectory) return integrationDirectory;
  const directory = mkdtempSync(path.join(os.tmpdir(), "mains-zsh-"));
  try {
    writeFileSync(path.join(directory, ".zshenv"), [
      "ZDOTDIR=\"${MAINS_ZSH_ORIGINAL_ZDOTDIR:-$HOME}\"",
      "[[ -r \"$ZDOTDIR/.zshenv\" ]] && source \"$ZDOTDIR/.zshenv\"",
      "typeset -g _mains_user_zdotdir=\"${ZDOTDIR:-$HOME}\"",
      "ZDOTDIR=\"$MAINS_ZSH_INTEGRATION_DIR\"",
    ].join("\n"));
    writeFileSync(path.join(directory, ".zshrc"), [
      "ZDOTDIR=\"${_mains_user_zdotdir:-$HOME}\"",
      "[[ -r \"$ZDOTDIR/.zshrc\" ]] && source \"$ZDOTDIR/.zshrc\"",
      "_mains_terminal_prompt() { builtin printf '\\033]633;Mains;%s;idle\\007' \"$MAINS_TERMINAL_TOKEN\"; }",
      "_mains_terminal_command() { builtin printf '\\033]633;Mains;%s;busy\\007' \"$MAINS_TERMINAL_TOKEN\"; }",
      "typeset -ga precmd_functions preexec_functions",
      "precmd_functions+=(_mains_terminal_prompt)",
      "preexec_functions+=(_mains_terminal_command)",
    ].join("\n"));
    integrationDirectory = directory;
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Private, token-scoped prompt signals; partial escape sequences never leak. */
export function terminalShellSignals(token: string) {
  const idle = `\x1b]633;Mains;${token};idle\x07`;
  const busy = `\x1b]633;Mains;${token};busy\x07`;
  let pending = "";
  let atPrompt: boolean | null = null;
  return {
    get atPrompt() { return atPrompt; },
    commandSent() { atPrompt = false; },
    consume(data: string): string {
      let remaining = pending + data;
      pending = "";
      let output = "";
      while (remaining) {
        const index = remaining.indexOf("\x1b");
        if (index < 0) { output += remaining; break; }
        output += remaining.slice(0, index);
        remaining = remaining.slice(index);
        if (remaining.startsWith(idle)) { atPrompt = true; remaining = remaining.slice(idle.length); }
        else if (remaining.startsWith(busy)) { atPrompt = false; remaining = remaining.slice(busy.length); }
        else if (idle.startsWith(remaining) || busy.startsWith(remaining)) { pending = remaining; break; }
        else { output += remaining[0]; remaining = remaining.slice(1); }
      }
      return output;
    },
  };
}

export function workspaceShellEnvironment(env: Record<string, string>) {
  const directory = shellDirectory();
  const token = randomUUID();
  return {
    signals: terminalShellSignals(token),
    env: { ...env, ZDOTDIR: directory, MAINS_ZSH_ORIGINAL_ZDOTDIR: env.ZDOTDIR || os.homedir(),
      MAINS_ZSH_INTEGRATION_DIR: directory, MAINS_TERMINAL_TOKEN: token },
  };
}

export function disposeShellIntegration(): void {
  if (!integrationDirectory) return;
  rmSync(integrationDirectory, { recursive: true, force: true });
  integrationDirectory = undefined;
}
