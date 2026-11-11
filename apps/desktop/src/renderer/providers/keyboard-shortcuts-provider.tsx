import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createShortcutWriteQueue } from "../../shared/capture-shortcut-lifecycle";
import { capabilities } from "@/lib/platform";
import type { ServiceResponse } from "../../shared/ipc-kit/service-response";
import {
  bindingsForKeyboardShortcuts,
  keyboardShortcutFromInput,
  type KeyboardShortcutId,
  type KeyboardShortcutOverrides,
} from "../../shared/keyboard-shortcuts";

export interface KeyboardShortcutsStatus {
  overrides: KeyboardShortcutOverrides;
  bindings: Record<KeyboardShortcutId, string | null>;
}

interface ShortcutRegistration {
  handler: () => void;
  enabled: boolean;
  allowInEditable: boolean;
}

interface KeyboardShortcutsContextValue extends KeyboardShortcutsStatus {
  isLoading: boolean;
  error: string | null;
  update: (id: KeyboardShortcutId, binding: string | null) => Promise<void>;
  resetAll: () => Promise<void>;
  register: (
    id: KeyboardShortcutId,
    registration: ShortcutRegistration,
  ) => () => void;
}

const DEFAULT_STATUS: KeyboardShortcutsStatus = {
  overrides: {},
  bindings: bindingsForKeyboardShortcuts({}),
};

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(
  null,
);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"]',
    ),
  );
}

export function KeyboardShortcutsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<KeyboardShortcutsStatus>(DEFAULT_STATUS);
  const [isLoading, setIsLoading] = useState(capabilities.windowChrome);
  const [error, setError] = useState<string | null>(null);
  const controls = useRef<{ queue: ReturnType<typeof createShortcutWriteQueue>; api: typeof window.api.keyboardShortcuts } | null>(null);
  const registrations = useRef(
    new Map<KeyboardShortcutId, Set<ShortcutRegistration>>(),
  );
  const statusRef = useRef(status);
  useLayoutEffect(() => {
    statusRef.current = status;
  }, [status]);

  const runShortcut = useCallback(
    (id: KeyboardShortcutId, target: EventTarget | null): boolean => {
      const registered = registrations.current.get(id);
      if (!registered) return false;
      const candidates = Array.from(registered);
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        if (!candidate?.enabled) continue;
        if (!candidate.allowInEditable && isEditableTarget(target)) continue;
        candidate.handler();
        return true;
      }
      return false;
    },
    [],
  );

  useLayoutEffect(() => {
    const queue = createShortcutWriteQueue();
    const api = window.api?.keyboardShortcuts;
    const owned = { queue, api };
    controls.current = owned;
    if (capabilities.windowChrome) {
      void queue.restore(async (): Promise<ServiceResponse<KeyboardShortcutsStatus>> => {
        try { return await api.get(); }
        catch (loadError) { return { success: false, error: loadError instanceof Error ? loadError.message : String(loadError) }; }
      }, (response) => {
        if (response.success) { setStatus(response.data); setError(null); }
        else setError(response.error);
        setIsLoading(false);
      });
    }
    return () => { void queue.stop(); if (controls.current === owned) controls.current = null; };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        isLoading ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        (event.target instanceof Element &&
          event.target.closest('[data-shortcut-recorder="true"]'))
      ) {
        return;
      }
      const pressed = keyboardShortcutFromInput(event);
      if (!pressed) return;
      const match = Object.entries(statusRef.current.bindings).find(
        ([, binding]) => binding === pressed,
      );
      if (!match) return;
      const [id] = match as [KeyboardShortcutId, string];
      if (!runShortcut(id, event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isLoading, runShortcut]);

  useEffect(() => {
    if (!capabilities.embeddedBrowser) return;
    const unsubscribe = window.api.browser.onShortcut((payload) => {
      if (payload.action !== "app-shortcut") return;
      runShortcut(payload.shortcutId, null);
    });
    return unsubscribe;
  }, [runShortcut]);

  const persist = useCallback(async (effect: (api: typeof window.api.keyboardShortcuts) => Promise<ServiceResponse<KeyboardShortcutsStatus>>) => {
    const owned = controls.current;
    if (!owned) throw new Error("Keyboard shortcut view is closed");
    return owned.queue.run(async (current) => {
      const response = await effect(owned.api);
      if (!current()) throw new Error("Keyboard shortcut view is closed");
      if (!response.success) throw new Error(response.error);
      setStatus(response.data); setError(null); setIsLoading(false);
    });
  }, []);
  const update = useCallback((id: KeyboardShortcutId, binding: string | null) => persist((api) => api.update({ id, binding })), [persist]);
  const resetAll = useCallback(() => persist((api) => api.resetAll()), [persist]);

  const register = useCallback(
    (id: KeyboardShortcutId, registration: ShortcutRegistration) => {
      const current = registrations.current.get(id) ?? new Set();
      current.add(registration);
      registrations.current.set(id, current);
      return () => {
        current.delete(registration);
        if (current.size === 0) registrations.current.delete(id);
      };
    },
    [],
  );

  const value = useMemo<KeyboardShortcutsContextValue>(
    () => ({ ...status, isLoading, error, update, resetAll, register }),
    [error, isLoading, register, resetAll, status, update],
  );

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}

export function useKeyboardShortcuts(): KeyboardShortcutsContextValue {
  const context = useContext(KeyboardShortcutsContext);
  if (!context) {
    throw new Error("useKeyboardShortcuts must be used within KeyboardShortcutsProvider");
  }
  return context;
}

export function useKeyboardShortcutBinding(
  id: KeyboardShortcutId,
): string | null {
  const context = useContext(KeyboardShortcutsContext);
  return context ? context.bindings[id] : DEFAULT_STATUS.bindings[id];
}

export function useKeyboardShortcut(
  id: KeyboardShortcutId,
  handler: () => void,
  options: { enabled?: boolean; allowInEditable?: boolean } = {},
): void {
  const register = useContext(KeyboardShortcutsContext)?.register;
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  const enabled = options.enabled ?? true;
  const allowInEditable = options.allowInEditable ?? false;

  useEffect(() => {
    if (!register) return;
    return register(id, {
      handler: () => handlerRef.current(),
      enabled,
      allowInEditable,
    });
  }, [allowInEditable, enabled, id, register]);
}
