export const OPEN_COMMAND_MENU_EVENT = "mains:open-command-menu";
export const COMMAND_MENU_QUICK_ACTION_EVENT =
  "mains:command-menu-quick-action";

export type CommandMenuQuickAction =
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
