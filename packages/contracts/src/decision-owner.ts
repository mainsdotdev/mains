/** Synchronous admission and view lifetime shared by decision surfaces. Native
 * acceptance remains authoritative after a view retires; a retired tail may
 * neither invoke a later action nor publish into its replacement view. */
export function createDecisionOwner(isCurrent: () => boolean = () => true) {
  let active = false, retired = false, pending: object | undefined;
  return {
    attach() { if (!retired) active = true; },
    detach() { active = false; pending = undefined; },
    retire() { retired = true; active = false; pending = undefined; },
    current: () => active && !retired && isCurrent(),
    begin() {
      if (!active || retired || pending || !isCurrent()) return;
      const identity = {}; pending = identity;
      const current = () => active && !retired && pending === identity && isCurrent();
      return { current,
        assertCurrent() { if (!current()) throw new Error("This decision's conversation or backend changed. Reopen it to continue."); },
        finish() { if (pending === identity) pending = undefined; },
      };
    },
  };
}
