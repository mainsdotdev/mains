export const CURSOR_CLOSED_ITERABLE_DIAGNOSTIC = "Error: RetriableError: WritableIterable is closed";
const connectPrefix = "Error: ConnectError: [";
const serverDiagnostic = "Something went wrong communicating with the server. Please try again.";

function diagnosticFor(text: string): string | undefined {
  const lines = text.replace(/\r\n/g, "\n").replace(/^\n+/, "").trimEnd().split("\n");
  const first = lines.shift() ?? "";
  if (first !== CURSOR_CLOSED_ITERABLE_DIAGNOSTIC && first !== serverDiagnostic &&
      !/^Error: ConnectError: \[(unavailable|aborted|deadline_exceeded)\].+$/.test(first)) return undefined;
  if (lines.every((line) => !line.trim() || /^\s+at\s/.test(line))) return first;
  return undefined;
}

function couldBeDiagnostic(text: string): boolean {
  const [first, ...tail] = text.replace(/\r\n/g, "\n").replace(/^\n+/, "").split("\n");
  const prefixes = [CURSOR_CLOSED_ITERABLE_DIAGNOSTIC, serverDiagnostic,
    ...["unavailable", "aborted", "deadline_exceeded"].map((code) => `${connectPrefix}${code}] `)];
  return (prefixes.some((prefix) => prefix.startsWith(first)) || !!diagnosticFor(first)) &&
    tail.every((line) => !line.trim() || /^\s+a(?:t(?:\s.*)?)?$/.test(line));
}

function insideCodeFence(text: string): boolean {
  let fence: string | undefined;
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!marker) continue;
    if (!fence) fence = marker;
    else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
  }
  return fence !== undefined;
}

/** Cursor leaks a title-only YAML header into ACP text, sometimes across deltas. */
function visibleText(text: string, final: boolean): string {
  const header = /^---\r?\n[ \t]*title:[^\r\n]*\r?\n---(?:\r?\n|$)/.exec(text);
  if (header) return text.slice(header[0].length).replace(/^(?:\r?\n)+/, "");
  if (!final && text.length <= 4096) {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r$/, "");
    if ("---\ntitle:".startsWith(normalized) || /^---\n[ \t]*title:[^\n]*(?:\n-{0,3})?$/.test(normalized)) return "";
  }
  return text;
}

/**
 * Keeps provider chrome out of the assistant lane. The transport diagnostic must
 * occupy its own ACP delta (or a sequence of diagnostic-only deltas). Prose,
 * quoted errors and fenced code stay untouched. A later explanation/recovery
 * disqualifies a tentative diagnostic, so it is restored to the response.
 */
export class CursorMessageStream {
  private text = "";
  private diagnostic = "";

  push(chunk: string): void {
    if (this.diagnostic) {
      this.diagnostic += chunk;
      if (!couldBeDiagnostic(this.diagnostic)) {
        this.text += this.diagnostic;
        this.diagnostic = "";
      }
      return;
    }
    const atBoundary = !this.text || /^(?:\r?\n){2}/.test(chunk) || /(?:\r?\n){2}$/.test(this.text);
    if (atBoundary && couldBeDiagnostic(chunk) && !insideCodeFence(this.text)) this.diagnostic = chunk;
    else this.text += chunk;
  }

  get content(): string { return visibleText(this.text, false); }

  finish(terminal = true): { content: string; failure?: string } {
    const failure = terminal ? diagnosticFor(this.diagnostic) : undefined;
    return {
      content: visibleText(this.text + (failure ? "" : this.diagnostic), true).replace(/^(?:\r?\n)+/, "").trimEnd(),
      failure,
    };
  }
}
