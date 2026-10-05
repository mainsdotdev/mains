/** Session-scoped capabilities injected into the provider; no service imports. */
export interface VoiceTaskTools {
  start(args: { taskKey: string; title: string; prompt: string }): Promise<unknown>;
  list(): Promise<unknown>;
  read(args: { runId: string }): Promise<unknown>;
  wait(args: { runId: string; afterCursor?: string; timeoutMs?: number }): Promise<unknown>;
  send(args: { runId: string; message: string; messageId: string }): Promise<unknown>;
  cancel(args: { runId: string }): Promise<unknown>;
  end(): Promise<unknown>;
}
