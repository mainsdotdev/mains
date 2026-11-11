// Remote plugin catalogs can exceed the old 32 MiB transport buffer limit.
// Keep a finite per-message budget without rescanning/copying prior chunks.
const MAX_MESSAGE_CHARS = 128 * 1024 * 1024;

/** One process owns its partial JSON object and string/escape state. */
export function createCodexJsonStream(maxMessageChars = MAX_MESSAGE_CHARS) {
  let parts: string[] = [];
  let length = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;

  function clear() {
    parts = []; length = 0; depth = 0; inString = false; escaped = false;
  }

  function append(part: string) {
    length += part.length;
    if (length > maxMessageChars) {
      clear();
      throw new Error(`Codex JSON-RPC message exceeded ${maxMessageChars} characters`);
    }
    parts.push(part);
  }

  function* push(chunk: string): Generator<string> {
    let start = depth ? 0 : -1;
    for (let index = 0; index < chunk.length; index++) {
      const character = chunk[index];
      if (!depth) {
        if (character === "{") { start = index; depth = 1; }
        continue;
      }
      if (escaped) { escaped = false; continue; }
      if (inString && character === "\\") { escaped = true; continue; }
      if (character === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (character === "{") depth++;
      else if (character === "}") {
        depth--;
        if (!depth) {
          append(chunk.slice(start, index + 1));
          const message = parts.join("");
          clear(); start = -1;
          yield message;
        }
      }
    }
    if (start !== -1) append(chunk.slice(start));
  }

  return { push, clear };
}
