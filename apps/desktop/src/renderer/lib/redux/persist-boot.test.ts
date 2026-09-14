import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readPersistedAppSetting } from "./persist-boot";
import { isThemePreference } from "./slices/appSettingsSlice";

// This module is the only reader of redux-persist's storage encoding, so these
// tests are what pins that format down. Every unhappy path must fall back
// rather than throw — it runs at module load, before React, and a throw here
// would take the whole renderer with it.
//
// The suite runs in the `node` environment (no jsdom in this repo), so storage
// is a small in-memory stand-in rather than a real Web Storage.

const KEY = "persist:appSettings";

let store: Map<string, string>;
let getItemThrows = false;

beforeEach(() => {
  store = new Map();
  getItemThrows = false;
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => {
      if (getItemThrows) throw new Error("storage disabled");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => void store.set(key, value),
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

/** Write a blob the way redux-persist does: values individually JSON-encoded. */
function writePersisted(fields: Record<string, unknown>): void {
  const encoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) encoded[k] = JSON.stringify(v);
  store.set(KEY, JSON.stringify(encoded));
}

const readTheme = () =>
  readPersistedAppSetting("theme", isThemePreference, "system");

describe("readPersistedAppSetting", () => {
  it("reads a value written in redux-persist's encoding", () => {
    writePersisted({ theme: "dark", sidebarWidth: 280 });
    expect(readTheme()).toBe("dark");
  });

  it("falls back when nothing has been persisted yet", () => {
    expect(readTheme()).toBe("system");
  });

  it("falls back when the field is absent from an existing blob", () => {
    writePersisted({ sidebarWidth: 280 });
    expect(readTheme()).toBe("system");
  });

  it("falls back when the stored value fails validation", () => {
    writePersisted({ theme: "chartreuse" });
    expect(readTheme()).toBe("system");
  });

  // The two layers of JSON are separate failure points; neither may throw.
  it("falls back on a corrupt outer blob", () => {
    store.set(KEY, "{not json");
    expect(readTheme()).toBe("system");
  });

  it("falls back on a corrupt inner value", () => {
    store.set(KEY, JSON.stringify({ theme: "{not json" }));
    expect(readTheme()).toBe("system");
  });

  // Should redux-persist ever stop JSON-encoding each value, the boot path has
  // to degrade to the default rather than crash.
  it("falls back when a value is not the expected JSON string", () => {
    store.set(KEY, JSON.stringify({ theme: { mode: "dark" } }));
    expect(readTheme()).toBe("system");
  });

  it("falls back when storage itself throws", () => {
    getItemThrows = true;
    expect(readTheme()).toBe("system");
  });
});
