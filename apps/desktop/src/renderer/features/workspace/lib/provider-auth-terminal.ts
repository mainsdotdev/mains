export interface ProviderAuthTerminalState {
  id: string;
  providerId: string;
  command: string;
  /** The original command remains for identity; only its pending delivery clears. */
  pendingCommand: string | null;
}

/** Duplicate opens join one login. Acknowledgements/close callbacks belong to
 * that login's incarnation, never a later provider or a reopened terminal. */
export function openProviderLogin(current: ProviderAuthTerminalState | null, request: { id: string; providerId: string; command: string }): ProviderAuthTerminalState {
  if (current?.providerId === request.providerId && current.command === request.command) return current;
  return { ...request, pendingCommand: request.command };
}
export function acknowledgeProviderLogin(current: ProviderAuthTerminalState | null, id: string | undefined): ProviderAuthTerminalState | null {
  return current && current.id === id ? { ...current, pendingCommand: null } : current;
}
export function closeProviderLogin(current: ProviderAuthTerminalState | null, id?: string): ProviderAuthTerminalState | null {
  return !id || current?.id === id ? null : current;
}
