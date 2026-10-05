export interface ComposerSendTarget {
  /** Run the next send continues, or null for a new chat. */
  runId: string | null;
  label: string;
  options: Array<{ runId: string | null; label: string }>;
}
