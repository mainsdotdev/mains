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

  useEffect(() => {
    if (!capabilities.windowChrome) return;
    let cancelled = false;
    void window.api.keyboardShortcuts.get().then(
      (response: ServiceResponse<KeyboardShortcutsStatus>) => {
        if (cancelled) return;
        if (response.success) {
          setStatus(response.data);
          setError(null);
        } else {
          setError(response.error);
        }
        setIsLoading(false);
      },
      (loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setIsLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
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

  const update = useCallback(
    async (id: KeyboardShortcutId, binding: string | null) => {
      const response = (await window.api.keyboardShortcuts.update({
        id,
        binding,
      })) as ServiceResponse<KeyboardShortcutsStatus>;
      if (!response.success) throw new Error(response.error);
      setStatus(response.data);
      setError(null);
    },
    [],
  );

  const resetAll = useCallback(async () => {
    const response = (await window.api.keyboardShortcuts.resetAll()) as ServiceResponse<KeyboardShortcutsStatus>;
    if (!response.success) throw new Error(response.error);
    setStatus(response.data);
    setError(null);
  }, []);

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
