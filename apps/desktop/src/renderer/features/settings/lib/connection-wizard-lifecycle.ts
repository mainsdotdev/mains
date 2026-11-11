type Step = "loading" | "setToken" | "add" | "manage";
type Action = "initialize" | "credentials" | "save" | "remove" | "discover" | "revoke";
const actions: Record<Step, readonly Action[]> = {
  loading: ["initialize"], setToken: ["credentials"], add: ["save"],
  manage: ["remove", "discover", "revoke"],
};
const destinations: Record<Action, readonly Step[]> = {
  initialize: ["setToken", "manage"], credentials: ["add"], save: ["manage"],
  remove: ["manage"], discover: ["add"], revoke: [],
};

/** One open wizard owns initialization, credential validation, selection,
 * removal and revocation. Closing or replacing its scope retires every tail. */
export function createConnectionWizardLifecycle(isCurrent: () => boolean) {
  let active = false, retired = false, step: Step = "loading";
  let pending: object | undefined;
  const usable = () => active && !retired && isCurrent();
  return {
    scope: crypto.randomUUID(),
    current: usable,
    attach() { if (!retired) active = true; },
    detach() { active = false; pending = undefined; step = "loading"; },
    retire() { retired = true; active = false; pending = undefined; },
    back(next: "manage" | "setToken") {
      if (!usable() || pending || step !== "add") return false;
      step = next; return true;
    },
    begin(action: Action = "initialize") {
      if (!usable() || pending || !actions[step].includes(action)) return;
      const identity = {}; pending = identity;
      const current = () => usable() && pending === identity;
      return {
        current,
        assertCurrent() { if (!current()) throw new Error("This connection dialog changed. Reopen it to continue."); },
        move(next: Step) {
          if (!current() || !destinations[action].includes(next)) return false;
          step = next; return true;
        },
        finish() { if (pending === identity) pending = undefined; },
      };
    },
  };
}
export type ConnectionWizardLifecycle = ReturnType<typeof createConnectionWizardLifecycle>;
