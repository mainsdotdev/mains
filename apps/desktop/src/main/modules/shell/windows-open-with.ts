import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { win32 as path } from "node:path";

export interface WindowsWorkspaceApp {
  id: string;
  name: string;
  // Kept for the existing installed-app DTO; Windows apps have no bundle id.
  bundleId: string;
  path: string;
  icon: string | null;
}

/** Resolve actual executables, including installs missing from an inherited PATH. */
export function getWindowsWorkspaceApps(): WindowsWorkspaceApp[] {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const localData = process.env.LOCALAPPDATA;
  const programRoots = [...new Set([
    process.env.ProgramW6432,
    process.env.ProgramFiles ?? "C:\\Program Files",
    process.env["ProgramFiles(x86)"],
  ].filter((value): value is string => !!value))];
  const appRoots = [
    ...(localData ? [path.join(localData, "Programs")] : []),
    ...programRoots,
  ];
  const pathDirs = (process.env.PATH ?? "").split(";")
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => path.isAbsolute(entry));
  const editors = [
    { id: "vscode", name: "Visual Studio Code", folder: "Microsoft VS Code", exe: "Code.exe" },
    { id: "cursor", name: "Cursor", folder: "cursor", exe: "Cursor.exe" },
    { id: "windsurf", name: "Windsurf", folder: "Windsurf", exe: "Windsurf.exe" },
    { id: "sublime-text", name: "Sublime Text", folder: "Sublime Text", exe: "sublime_text.exe" },
  ];
  const candidates = [
    { id: "explorer", name: "File Explorer", paths: [path.join(systemRoot, "explorer.exe")] },
    { id: "powershell", name: "PowerShell", paths: [path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")] },
    ...editors.map((editor) => ({
      ...editor,
      paths: [
        ...appRoots.map((root) => path.join(root, editor.folder, editor.exe)),
        ...pathDirs.flatMap((dir) => [
          path.join(dir, editor.exe),
          // Editor installers put their .cmd launcher in <install>/bin.
          ...(path.basename(dir).toLowerCase() === "bin"
            ? [path.join(dir, "..", editor.exe)] : []),
        ]),
      ],
    })),
  ];
  return candidates.flatMap((candidate) => {
    const executable = candidate.paths.find((filePath) => {
      if (!path.isAbsolute(filePath)) return false;
      try { return fs.statSync(filePath).isFile(); } catch { return false; }
    });
    return executable ? [{
      id: candidate.id, name: candidate.name, path: executable,
      bundleId: "", icon: null,
    }] : [];
  });
}

/** Open an existing workspace using a known, locally resolved app. */
export async function openWindowsWorkspaceInApp(appId: string, folder: string): Promise<void> {
  if (typeof appId !== "string" || typeof folder !== "string" ||
      !path.isAbsolute(folder) || path.normalize(folder) !== folder) {
    throw new Error("Invalid workspace path");
  }
  if (!fs.statSync(folder).isDirectory()) throw new Error("Workspace folder not found");
  const target = getWindowsWorkspaceApps().find((item) => item.id === appId);
  if (!target) throw new Error("Application is no longer installed");
  const args = appId === "powershell"
    ? ["-NoLogo", "-NoExit", "-Command", `Set-Location -LiteralPath '${folder.replace(/'/g, "''")}'`]
    : [folder];
  // No cmd.exe or .cmd wrappers: workspace names stay literal argv values.
  const child = spawn(target.path, args, {
    cwd: folder, detached: true, stdio: "ignore", shell: false,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}
