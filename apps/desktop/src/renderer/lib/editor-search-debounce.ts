const EDITOR_SEARCH_DEBOUNCE_MS = 150;

/**
 * Debounce the find panel (Cmd+F) of the `@pierre/diffs` editors under `root`.
 *
 * The panel re-searches the whole document and repaints every highlight on
 * each keystroke — one letter in a long file is thousands of matches, redrawn
 * per key. The library has no option for it, so this sits in front of the
 * panel's own listener: `input` events from its search box (`input[data-search]`)
 * are caught on the way down, in the capture phase outside the editor's shadow
 * root, held, and replayed on the same box once typing pauses.
 *
 * Keys that act on the matches settle a held keystroke first: Enter and
 * Cmd/Ctrl+G replay it so they never step through the previous query's
 * matches, and Escape drops it so a closed panel can't repaint highlights.
 *
 * Returns the cleanup.
 */
export function debounceEditorSearchInput(
  root: HTMLElement,
  delayMs = EDITOR_SEARCH_DEBOUNCE_MS,
): () => void {
  const replays = new WeakSet<Event>();
  let pending: {
    input: HTMLInputElement;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  const drop = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };

  const replay = () => {
    if (!pending) return;
    const { input } = pending;
    drop();
    // The close button removes the panel without a key press.
    if (!input.isConnected) return;
    const event = new Event("input", { bubbles: true, composed: true });
    replays.add(event);
    input.dispatchEvent(event);
  };

  const searchInputOf = (event: Event): HTMLInputElement | null => {
    const target = event.composedPath()[0];
    return target instanceof HTMLInputElement && target.dataset.search !== undefined
      ? target
      : null;
  };

  const onInput = (event: Event) => {
    if (replays.has(event)) return;
    const input = searchInputOf(event);
    if (!input) return;
    event.stopPropagation();
    if (pending) clearTimeout(pending.timer);
    pending = { input, timer: setTimeout(replay, delayMs) };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!pending || searchInputOf(event) !== pending.input) return;
    if (event.key === "Escape") {
      drop();
    } else if (
      event.key === "Enter" ||
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g")
    ) {
      replay();
    }
  };

  root.addEventListener("input", onInput, true);
  root.addEventListener("keydown", onKeyDown, true);
  return () => {
    root.removeEventListener("input", onInput, true);
    root.removeEventListener("keydown", onKeyDown, true);
    drop();
  };
}
