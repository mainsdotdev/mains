export const OPEN_COMMAND_MENU_EVENT = "mains:open-command-menu";
export const COMMAND_MENU_QUICK_ACTION_EVENT =
  "mains:command-menu-quick-action";

let commandMenuOpen = false;
const commandMenuListeners = new Set<() => void>();

export function getCommandMenuOpen(): boolean {
  return commandMenuOpen;
}

export function subscribeCommandMenuOpen(listener: () => void): () => void {
  commandMenuListeners.add(listener);
  return () => {
    commandMenuListeners.delete(listener);
  };
}

export function setCommandMenuOpen(open: boolean): void {
  if (commandMenuOpen === open) return;
  commandMenuOpen = open;
  commandMenuListeners.forEach((listener) => listener());
}

export type CommandMenuQuickAction =
  | "open-add-project"
  | "add-project-from-local"
  | "clone-project-from-url"
  | "create-code-project"
  | "create-collection-project";

export function requestCommandMenu(): void {
  window.dispatchEvent(new Event(OPEN_COMMAND_MENU_EVENT));
}

export function requestCommandMenuQuickAction(
  action: CommandMenuQuickAction,
): void {
  window.dispatchEvent(
    new CustomEvent<CommandMenuQuickAction>(COMMAND_MENU_QUICK_ACTION_EVENT, {
      detail: action,
    }),
  );
}

export function listenForCommandMenuQuickActions(
  listener: (action: CommandMenuQuickAction) => void,
): () => void {
  const handleAction = (event: Event) => {
    listener((event as CustomEvent<CommandMenuQuickAction>).detail);
  };
  window.addEventListener(COMMAND_MENU_QUICK_ACTION_EVENT, handleAction);
  return () =>
    window.removeEventListener(COMMAND_MENU_QUICK_ACTION_EVENT, handleAction);
}
