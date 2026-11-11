import type { SshHost } from "./ssh.service";

/** Parse the relevant fields out of an ~/.ssh/config file. Pure + best-effort. */
export function parseSshConfig(text: string): SshHost[] {
  const hosts: SshHost[] = [];
  let current: {
    aliases: string[];
    hostName: string | null;
    user: string | null;
    port: number | null;
  } | null = null;

  const flush = () => {
    if (!current) return;
    for (const alias of current.aliases) {
      hosts.push({
        alias,
        hostName: current.hostName,
        user: current.user,
        port: current.port,
      });
    }
    current = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toLowerCase();
    const value = parts.slice(1).join(" ");
    if (key === "host") {
      flush();
      // Skip pattern hosts (`*`, `?`); keep concrete aliases only.
      const aliases = parts
        .slice(1)
        .filter((a) => !a.includes("*") && !a.includes("?"));
      current = { aliases, hostName: null, user: null, port: null };
    } else if (current) {
      if (key === "hostname") current.hostName = value;
      else if (key === "user") current.user = value;
      else if (key === "port") {
        const p = Number(value);
        if (Number.isFinite(p)) current.port = p;
      }
    }
  }
  flush();
  return hosts;
}

/** Build the `ssh` argv for a loopback forward. Pure + testable. */
export function buildSshArgs(input: {
  localPort: number;
  host: string;
  remotePort: number;
  remoteCommand?: string | null;
}): string[] {
  const args = [
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-L",
    `${input.localPort}:127.0.0.1:${input.remotePort}`,
  ];
  if (input.remoteCommand && input.remoteCommand.trim()) {
    args.push(input.host, input.remoteCommand.trim());
  } else {
    args.push("-N", input.host);
  }
  return args;
}

/**
 * Hosts seen in ~/.ssh/known_hosts (so the picker isn't limited to aliases in
 * the config). Hashed entries (`|1|…`, from HashKnownHosts) can't be reversed,
 * so they're skipped. Pure + best-effort.
 */
export function parseKnownHosts(text: string): string[] {
  const hosts = new Set<string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("|")) continue;
    const first = line.split(/\s+/)[0];
    if (!first) continue;
    for (const entry of first.split(",")) {
      let h = entry.trim();
      const bracket = h.match(/^\[(.+)\]:\d+$/); // [host]:port
      if (bracket) h = bracket[1];
      else h = h.replace(/:\d+$/, "");
      if (h && !h.includes("*") && !h.includes("?")) hosts.add(h);
    }
  }
  return [...hosts];
}

// `ssh host "<cmd>"` runs a NON-interactive, non-login shell where node version
// managers (volta/nvm/mise/fnm/asdf) aren't sourced — so `npm`/`node` are often
// missing and a bare `npm run serve` fails. Source them so the launch Just Works.
const NODE_LAUNCH_PREAMBLE = [
  `export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"`,
  `[ -d "$HOME/.volta/bin" ] && export PATH="$HOME/.volta/bin:$PATH"`,
  `[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1`,
  `command -v fnm >/dev/null 2>&1 && eval "$(fnm env 2>/dev/null)" >/dev/null 2>&1`,
  `command -v mise >/dev/null 2>&1 && eval "$(mise activate bash 2>/dev/null)" >/dev/null 2>&1`,
  `[ -s "$HOME/.asdf/asdf.sh" ] && . "$HOME/.asdf/asdf.sh" >/dev/null 2>&1`,
].join("\n");

/**
 * Wrap a user-provided launch command with the node-discovery preamble and the
 * ephemeral owner token, so the remote `mains serve` starts even from a bare
 * non-interactive SSH shell. Pure + testable.
 */
export function wrapRemoteLaunch(userCommand: string, token: string): string {
  return `${NODE_LAUNCH_PREAMBLE}\nexport MAINS_SERVE_TOKEN='${token}'\n${userCommand.trim()}`;
}
