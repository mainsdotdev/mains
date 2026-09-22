/**
 * The one place that reads redux-persist's on-disk encoding directly.
 *
 * Everything the renderer persists lives in redux slices behind the whitelists
 * in `./index.ts`, and every consumer reads it through the store. The single
 * exception is state that must be applied before the first paint: rehydration
 * is async, so a value like the theme would flash the default at every launch
 * if it waited for the store. Those callers use `readPersistedAppSetting` (or,
 * for the app theme's active provider, `readPersistedWorkspaceSetting`), and
 * keeping them here means the coupling is one documented seam rather than a
 * habit.
 *
 * Encoding: redux-persist writes `persist:<key>` as a JSON object whose values
 * are each individually JSON-encoded — `{"theme":"\"dark\"","sidebarWidth":"280"}`.
 * Reads fail soft: an unrecognised shape yields the fallback, and rehydration
 * corrects the store a tick later.
 */

function readPersistedField<T>(
  persistKey: string,
  field: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(persistKey);
    if (!raw) return fallback;
    const blob: unknown = JSON.parse(raw);
    if (!blob || typeof blob !== "object") return fallback;
    const encoded = (blob as Record<string, unknown>)[field];
    if (typeof encoded !== "string") return fallback;
    const value: unknown = JSON.parse(encoded);
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read one already-persisted `appSettings` field synchronously, for the rare
 * caller that cannot wait for rehydration. `fallback` covers "never persisted"
 * and "stored value is not what we expect" alike.
 */
export function readPersistedAppSetting<T>(
  field: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): T {
  return readPersistedField("persist:appSettings", field, isValid, fallback);
}

/** Same, for a persisted `workspace` field. */
export function readPersistedWorkspaceSetting<T>(
  field: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): T {
  return readPersistedField("persist:workspace", field, isValid, fallback);
}
