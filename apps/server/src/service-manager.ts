import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CliOptions } from "./server-cli-options";

const SERVICE_ID = "dev.mains.server";
const SYSTEMD_UNIT = "mains-server.service";

export type ServiceAction =
  | "install"
  | "uninstall"
  | "start"
  | "stop"
  | "restart"
  | "status";

export interface ServiceDefinitionOptions {
  nodePath: string;
  scriptPath: string;
  homeDir: string;
  pathEnv: string;
  server: CliOptions;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function systemdQuote(value: string): string {
  return `"${value
    .replace(/%/g, "%%")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}

export function serviceServerArgs(options: CliOptions): string[] {
  const args = [
    "serve",
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--data-dir",
    path.resolve(options.dataDir),
    "--no-pairing",
  ];
  if (options.webRoot) args.push("--web-root", path.resolve(options.webRoot));
  for (const url of options.publicUrls) args.push("--public-url", url);
  if (options.tailscaleServe) args.push("--tailscale-serve");
  if (options.tailscaleServePort !== undefined) {
    args.push("--tailscale-serve-port", String(options.tailscaleServePort));
  }
  return args;
}

export function renderLaunchAgent(
  options: ServiceDefinitionOptions,
): string {
  const logsDir = path.join(path.resolve(options.server.dataDir), "logs");
  const args = [
    options.nodePath,
    options.scriptPath,
    ...serviceServerArgs(options.server),
  ];
  const argumentsXml = args
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_ID}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>3</integer>
  <key>Umask</key>
  <integer>63</integer>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(options.homeDir)}</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logsDir, "server.stdout.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logsDir, "server.stderr.log"))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(options.pathEnv)}</string>
    <key>MAINS_SERVER_SERVICE</key>
    <string>1</string>
  </dict>
</dict>
</plist>
`;
}

export function renderSystemdUserUnit(
  options: ServiceDefinitionOptions,
): string {
  const logsDir = path.join(path.resolve(options.server.dataDir), "logs");
  const args = [
    options.nodePath,
    options.scriptPath,
    ...serviceServerArgs(options.server),
  ];
  return `[Unit]
Description=Mains standalone server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${args.map(systemdQuote).join(" ")}
WorkingDirectory=${systemdQuote(options.homeDir)}
Environment=${systemdQuote(`PATH=${options.pathEnv}`)}
Environment=MAINS_SERVER_SERVICE=1
Restart=on-failure
RestartSec=3
UMask=0077
StandardOutput=${systemdQuote(`append:${path.join(logsDir, "server.stdout.log")}`)}
StandardError=${systemdQuote(`append:${path.join(logsDir, "server.stderr.log")}`)}

[Install]
WantedBy=default.target
`;
}

function writeDefinition(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function execute(
  command: string,
  args: string[],
  options: { ignoreFailure?: boolean } = {},
): void {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const showOutput = !options.ignoreFailure || result.status === 0;
  if (showOutput && result.stdout) process.stdout.write(result.stdout);
  if (showOutput && result.stderr) process.stderr.write(result.stderr);
  if (result.error && !options.ignoreFailure) throw result.error;
  if (result.status !== 0 && !options.ignoreFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status ?? "unknown"}`,
    );
  }
}

function definitionOptions(server: CliOptions): ServiceDefinitionOptions {
  const scriptArg = process.argv[1];
  if (!scriptArg) throw new Error("Could not resolve the Mains Server executable");
  return {
    nodePath: process.execPath,
    scriptPath: path.resolve(scriptArg),
    homeDir: os.homedir(),
    pathEnv: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    server,
  };
}

function assertInstallOptions(options: CliOptions): void {
  if (options.token !== undefined) {
    throw new Error(
      "Do not put --token in a service definition; Mains Server persists an owner-only token automatically.",
    );
  }
  if (options.rotateToken) {
    throw new Error("Rotate the owner token before installing the service");
  }
  if (options.port === 0) {
    throw new Error("A background service requires a stable non-zero port");
  }
}

function launchAgentPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${SERVICE_ID}.plist`);
}

function systemdUnitPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", SYSTEMD_UNIT);
}

function runLaunchAgent(action: ServiceAction, server: CliOptions): void {
  const filePath = launchAgentPath();
  const domain = `gui/${process.getuid?.() ?? os.userInfo().uid}`;
  const target = `${domain}/${SERVICE_ID}`;

  if (action === "install") {
    assertInstallOptions(server);
    fs.mkdirSync(path.join(path.resolve(server.dataDir), "logs"), {
      recursive: true,
      mode: 0o700,
    });
    execute("launchctl", ["bootout", domain, filePath], { ignoreFailure: true });
    writeDefinition(filePath, renderLaunchAgent(definitionOptions(server)));
    execute("launchctl", ["bootstrap", domain, filePath]);
    execute("launchctl", ["enable", target]);
    execute("launchctl", ["kickstart", "-k", target]);
    console.log(`Installed and started ${SERVICE_ID}`);
    console.log(`Definition: ${filePath}`);
    console.log(`Logs: ${path.join(path.resolve(server.dataDir), "logs")}`);
    return;
  }
  if (action === "uninstall") {
    execute("launchctl", ["bootout", domain, filePath], { ignoreFailure: true });
    fs.rmSync(filePath, { force: true });
    console.log(`Uninstalled ${SERVICE_ID}; server data was kept.`);
    return;
  }
  if (action === "start") execute("launchctl", ["kickstart", target]);
  else if (action === "stop") execute("launchctl", ["kill", "SIGTERM", target]);
  else if (action === "restart") execute("launchctl", ["kickstart", "-k", target]);
  else execute("launchctl", ["print", target]);
}

function runSystemdUserService(action: ServiceAction, server: CliOptions): void {
  const filePath = systemdUnitPath();
  if (action === "install") {
    assertInstallOptions(server);
    fs.mkdirSync(path.join(path.resolve(server.dataDir), "logs"), {
      recursive: true,
      mode: 0o700,
    });
    writeDefinition(filePath, renderSystemdUserUnit(definitionOptions(server)));
    execute("systemctl", ["--user", "daemon-reload"]);
    execute("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT]);
    console.log(`Installed and started ${SYSTEMD_UNIT}`);
    console.log(`Definition: ${filePath}`);
    console.log(
      "To keep it running after logout, enable user lingering if needed: loginctl enable-linger $USER",
    );
    return;
  }
  if (action === "uninstall") {
    execute("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT], {
      ignoreFailure: true,
    });
    fs.rmSync(filePath, { force: true });
    execute("systemctl", ["--user", "daemon-reload"]);
    execute("systemctl", ["--user", "reset-failed", SYSTEMD_UNIT], {
      ignoreFailure: true,
    });
    console.log(`Uninstalled ${SYSTEMD_UNIT}; server data was kept.`);
    return;
  }
  const verb = action === "status" ? "status" : action;
  const args = ["--user", verb, SYSTEMD_UNIT];
  if (action === "status") args.push("--no-pager");
  execute("systemctl", args);
}

export function runServiceCommand(
  action: string | undefined,
  server: CliOptions,
): void {
  const valid: ServiceAction[] = [
    "install",
    "uninstall",
    "start",
    "stop",
    "restart",
    "status",
  ];
  if (!action || !valid.includes(action as ServiceAction)) {
    throw new Error(
      `Service action must be one of: ${valid.join(", ")}`,
    );
  }
  if (process.platform === "darwin") {
    runLaunchAgent(action as ServiceAction, server);
    return;
  }
  if (process.platform === "linux") {
    runSystemdUserService(action as ServiceAction, server);
    return;
  }
  throw new Error("Background service management currently supports macOS and Linux");
}
