import type { SkillInfo } from "@/lib/redux/api/providersApi";
import type { Space } from "@/lib/redux/api/spaceApi";
import { hasImageInstruction, isImageGenAvailable } from "./image-creation";

const activeStatus = (status: string | undefined) => status === "running" || status === "queued";

export interface ImageCreatorState {
  phase: "idle" | "preparing" | "submitting" | "accepted" | "retired";
  stopping: boolean;
}

/** A mounted image view owns preparation and native delivery independently of
 * React loading flags. Cancel is possible only before native submission. */
export function createImageCreatorLifecycle(isCurrent: () => boolean = () => true, expectedAccountId?: string) {
  let view: object | undefined, retired = false, draftRevision = 0, latestEligibility = false;
  let currentSkillKey = "";
  let observedRun: { id: string; status: string } | undefined;
  let pending: object | undefined, stopping: object | undefined;
  let release: (() => void) | undefined;
  const stopped = new Set<string>();
  let state: ImageCreatorState = { phase: "idle", stopping: false };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<ImageCreatorState>) => {
    state = { ...state, ...patch }; for (const listener of listeners) listener();
  };
  const current = (accountId?: string) => !!view && !retired && isCurrent() &&
    (accountId === undefined || expectedAccountId === undefined || accountId === expectedAccountId);
  const canSubmit = (eligible: boolean) => current() && eligible && !pending && !stopping && state.phase === "idle";
  const drop = () => { pending = undefined; stopping = undefined; release?.(); release = undefined; };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    current,
    observeEligibility(value: boolean, skill?: SkillInfo) {
      latestEligibility = value;
      currentSkillKey = skill ? JSON.stringify([skill.name, skill.path, skill.scope, skill.mentionPath]) : "";
    },
    attach() {
      const owner = {}; view = owner;
      return () => { if (view === owner) { view = undefined; drop(); state = { phase: retired ? "retired" : "idle", stopping: false }; } };
    },
    retire() { retired = true; drop(); publish({ phase: "retired", stopping: false }); },
    editDraft() { draftRevision++; },
    canSubmit,
    beginSubmission(eligible: boolean) {
      if (!canSubmit(eligible)) return;
      const owner = view, token = {}, revision = draftRevision, skillKey = currentSkillKey;
      let accepted = false;
      pending = token; publish({ phase: "preparing" });
      const owns = () => current() && view === owner && pending === token;
      return {
        current: owns,
        unchangedDraft: () => owns() && revision === draftRevision,
        own(cleanup: () => void) { if (owns()) release = cleanup; else cleanup(); },
        submit() {
          if (!owns() || state.phase !== "preparing" || !latestEligibility || skillKey !== currentSkillKey) return false;
          publish({ phase: "submitting" }); return true;
        },
        accept(newConversation: boolean) {
          if (!owns() || state.phase !== "submitting") return false;
          accepted = newConversation; publish({ phase: "accepted" }); return true;
        },
        finish() {
          if (pending !== token) return;
          pending = undefined; release?.(); release = undefined;
          publish({ phase: accepted ? "accepted" : "idle" });
        },
      };
    },
    cancelPreparation() {
      if (!current() || state.phase !== "preparing") return false;
      pending = undefined; release?.(); release = undefined; publish({ phase: "idle" }); return true;
    },
    observeRun(run: { id: string; status: string } | undefined) {
      observedRun = run;
      if (run && !activeStatus(run.status)) stopped.delete(run.id);
    },
    beginStop(runId: string, active: boolean) {
      if (!current() || !active || stopping || stopped.has(runId)) return;
      const owner = view, token = {}; stopping = token; publish({ stopping: true });
      const owns = () => current() && view === owner && stopping === token;
      return {
        current: owns,
        succeed() { if (owns() && (observedRun?.id !== runId || activeStatus(observedRun?.status))) stopped.add(runId); },
        finish() { if (stopping === token) { stopping = undefined; publish({ stopping: false }); } },
      };
    },
  };
}

export function availableImageSkill(skill: SkillInfo | undefined, loading: boolean, error: unknown) {
  return !loading && !error && isImageGenAvailable(skill) ? skill : undefined;
}

export function allowsImageSubmission(input: {
  skill: SkillInfo | undefined; prompt: string; runsLoaded: boolean; settingsReady: boolean; loading: boolean;
  runId?: string; activeRun?: { id: string; status: string };
}) {
  return !!input.skill && hasImageInstruction(input.prompt, input.skill) && input.runsLoaded && input.settingsReady && !input.loading &&
    !activeStatus(input.activeRun?.status) && (!input.runId || input.activeRun?.id === input.runId);
}

export function isImageCreatorSpace(space: Space, accountId: string) {
  return space.accountId === accountId && space.providerId === "codex";
}

export function findImageCreatorSpace(accountId: string, spaces: readonly Space[], activeId?: string, runSpaceId?: string | null) {
  if (runSpaceId !== undefined) return spaces.find((space) => space.id === runSpaceId);
  const available = (space: Space) => !space.isArchived && isImageCreatorSpace(space, accountId);
  return spaces.find((space) => space.id === activeId && available(space)) ?? spaces.find(available);
}

export function imageCreatorRunError(accountId: string, runId: string | undefined, run: {
  accountId: string; providerId: string; mode: string;
} | null | undefined, failed: unknown, loaded: boolean, space: Space | null | undefined) {
  if (!runId) return null;
  if (failed || (run !== undefined && (!run || run.accountId !== accountId || run.providerId !== "codex" || run.mode !== "work"))) return "Could not open this image run.";
  if (run && loaded && (!space || !isImageCreatorSpace(space, accountId))) return "The Codex space for this image run is unavailable.";
  return null;
}

interface ImageSetupState {
  phase: "idle" | "creating" | "ready" | "error" | "retired";
  space: Space | null;
  error: unknown;
}

/** Discovery may reuse one creation across Strict Mode setup. A failed
 * creation retries only after an explicit retry; retirement never replays it. */
export function createImageSetupLifecycle(accountId: string, isCurrent: () => boolean) {
  let view: object | undefined, retired = false;
  let state: ImageSetupState = { phase: "idle", space: null, error: null };
  const listeners = new Set<() => void>();
  const publish = (next: ImageSetupState) => { state = next; if (view) for (const listener of listeners) listener(); };
  const ensure = (create: () => Promise<Space>) => {
    if (!view || retired || !isCurrent() || state.phase !== "idle") return;
    publish({ phase: "creating", space: null, error: null });
    let promise: Promise<Space>;
    try { promise = create(); } catch (error) { promise = Promise.reject(error); }
    void promise.then((space) => {
      if (!isImageCreatorSpace(space, accountId) || space.isArchived) throw new Error("The created Codex space is not available for this account.");
      if (!retired && isCurrent()) publish({ phase: "ready", space, error: null });
    }).catch((error: unknown) => {
      if (!retired && isCurrent()) publish({ phase: "error", space: null, error });
    });
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    attach() { const owner = {}; view = owner; return () => { if (view === owner) view = undefined; }; },
    retire() { retired = true; publish({ phase: "retired", space: null, error: null }); },
    ensure,
    retry(create: () => Promise<Space>) {
      if (!view || retired || !isCurrent() || state.phase !== "error") return;
      state = { phase: "idle", space: null, error: null }; ensure(create);
    },
  };
}
