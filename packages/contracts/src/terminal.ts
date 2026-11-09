export interface TerminalCreateOptions {
  id: string;
  cwd?: string;
  workspaceId?: string;
  workspaceName?: string;
}

export interface TerminalServer {
  pid: number;
  port: number;
  command: string;
}

export interface TerminalSession {
  id: string;
  /** Native process incarnation; an id may be reused after explicit removal. */
  instanceId?: string;
  cwd: string;
  workspaceId: string | null;
  workspaceName: string | null;
  title: string;
  status: "running" | "exited";
  exitCode: number | null;
  createdAt: number;
  /** Verified TCP listeners owned by this shell's process tree; null means unchecked/unavailable. */
  servers: TerminalServer[] | null;
}

export interface TerminalWriteOptions {
  instanceId?: string;
  /** One-shot command receipt, scoped to this native process. */
  commandId?: string;
}

/** A bounded output replay; subsequent stream events have larger sequences. */
export interface TerminalSnapshot {
  session: TerminalSession;
  data: string;
  sequence: number;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
  sequence: number;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number;
}
