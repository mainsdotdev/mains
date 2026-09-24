// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounceEditorSearchInput } from "./editor-search-debounce";

/** A stand-in for the editor: its find box lives in an open shadow root. */
function mountEditor() {
  const root = document.createElement("div");
  const host = document.createElement("diffs-container");
  const shadow = host.attachShadow({ mode: "open" });
  const input = document.createElement("input");
  input.dataset.search = "";
  const seen: string[] = [];
  const keys: string[] = [];
  // The library assigns its handlers as properties, like this.
  input.oninput = () => seen.push(input.value);
  input.onkeydown = (event) => keys.push(`${event.key}:${seen.length}`);
  shadow.appendChild(input);
  root.appendChild(host);
  document.body.appendChild(root);
  return { root, input, seen, keys };
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

function press(input: HTMLInputElement, key: string, init: KeyboardEventInit = {}) {
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, composed: true, ...init }),
  );
}

describe("debounceEditorSearchInput", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("delivers one search once typing pauses", () => {
    const { root, input, seen } = mountEditor();
    debounceEditorSearchInput(root, 150);

    type(input, "s");
    type(input, "se");
    vi.advanceTimersByTime(100);
    type(input, "sea");
    expect(seen).toEqual([]);

    vi.advanceTimersByTime(150);
    expect(seen).toEqual(["sea"]);
  });

  it("settles a held keystroke before Enter steps through matches", () => {
    const { root, input, seen, keys } = mountEditor();
    debounceEditorSearchInput(root, 150);

    type(input, "foo");
    press(input, "Enter");
    expect(seen).toEqual(["foo"]);
    // The panel's own Enter handler ran after the search it depends on.
    expect(keys).toEqual(["Enter:1"]);

    vi.advanceTimersByTime(150);
    expect(seen).toEqual(["foo"]);
  });

  it("settles on Cmd/Ctrl+G too", () => {
    const { root, input, seen } = mountEditor();
    debounceEditorSearchInput(root, 150);

    type(input, "foo");
    press(input, "g", { metaKey: true });
    expect(seen).toEqual(["foo"]);
  });

  it("drops a held keystroke when Escape closes the panel", () => {
    const { root, input, seen } = mountEditor();
    debounceEditorSearchInput(root, 150);

    type(input, "foo");
    press(input, "Escape");
    vi.advanceTimersByTime(150);
    expect(seen).toEqual([]);
  });

  it("drops it when the panel is gone before the delay ends", () => {
    const { root, input, seen } = mountEditor();
    debounceEditorSearchInput(root, 150);

    type(input, "foo");
    input.remove();
    vi.advanceTimersByTime(150);
    expect(seen).toEqual([]);
  });

  it("leaves other inputs alone and stops after cleanup", () => {
    const { root, input, seen } = mountEditor();
    const cleanup = debounceEditorSearchInput(root, 150);

    delete input.dataset.search;
    type(input, "replace box");
    expect(seen).toEqual(["replace box"]);

    input.dataset.search = "";
    cleanup();
    type(input, "after");
    expect(seen).toEqual(["replace box", "after"]);
  });
});
