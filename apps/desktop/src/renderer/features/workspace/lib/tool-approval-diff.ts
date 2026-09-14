import { normalizePatchForPatchDiff } from "./patch-utils";

export type ApprovalDiffKind = "edit" | "write" | "delete" | "apply-patch";

export interface ApprovalDiffPreview {
  filePath: string;
  patch: string;
}

/**
 * Turn the different provider file-mutation payloads into the one format the
 * approval UI renders: one single-file unified patch per affected file.
 */
export function buildApprovalDiffPreviews(
  kind: ApprovalDiffKind,
  input: Record<string, unknown>,
): ApprovalDiffPreview[] {
  if (kind === "apply-patch") {
    const envelope = findPatchEnvelope(input);
    if (envelope) return previewsFromEnvelope(envelope);
  }

  const filePath = inputFilePath(input);
  const rawDiff = stringValue(input.diff ?? input.patch);
  if (rawDiff && !rawDiff.includes("*** Begin Patch")) {
    return [{
      filePath,
      patch: normalizeRawDiff(rawDiff, filePath, kind),
    }];
  }

  if (kind === "write") {
    const content = stringValue(input.content ?? input.file_text);
    return [{
      filePath,
      patch: content === undefined
        ? ""
        : buildUnifiedDiff(
            splitTextLines(content).map((text) => `+${text}`),
            filePath,
            "write",
          ),
    }];
  }

  if (kind === "edit") {
    const oldText = stringValue(input.old_string ?? input.old_str);
    const newText = stringValue(input.new_string ?? input.new_str);
    if (oldText !== undefined || newText !== undefined) {
      const lines = [
        ...splitTextLines(oldText ?? "").map((text) => `-${text}`),
        ...splitTextLines(newText ?? "").map((text) => `+${text}`),
      ];
      return [{
        filePath,
        patch: buildUnifiedDiff(lines, filePath, "edit"),
      }];
    }
  }

  return [{ filePath, patch: "" }];
}

function inputFilePath(input: Record<string, unknown>): string {
  return stringValue(
    input.fileName ??
      input.filePath ??
      input.file_path ??
      input.path ??
      input.file,
  ) ?? "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function splitTextLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // A final newline terminates the last line; it does not create another one.
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

function findPatchEnvelope(input: Record<string, unknown>): string | undefined {
  const candidates = [input.args, input.patch, input.input, input.content];
  for (const candidate of [...candidates, ...Object.values(input)]) {
    if (
      typeof candidate === "string" &&
      candidate.includes("*** Begin Patch")
    ) {
      return candidate;
    }
  }
  return undefined;
}

function previewsFromEnvelope(envelope: string): ApprovalDiffPreview[] {
  const lines = envelope.replace(/\r\n/g, "\n").split("\n");
  const previews: ApprovalDiffPreview[] = [];
  let current: {
    filePath: string;
    action: ApprovalDiffKind;
    body: string[];
  } | null = null;

  const flush = () => {
    if (!current) return;
    previews.push({
      filePath: current.filePath,
      patch: current.body.length > 0
        ? buildUnifiedDiff(current.body, current.filePath, current.action)
        : "",
    });
  };

  for (const line of lines) {
    const header = line.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/);
    if (header) {
      flush();
      current = {
        filePath: header[2].trim(),
        action: header[1] === "Add"
          ? "write"
          : header[1] === "Delete"
            ? "delete"
            : "edit",
        body: [],
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("*** End Patch")) {
      flush();
      current = null;
      break;
    }
    if (line.startsWith("*** Move to:")) {
      current.filePath = line.slice("*** Move to:".length).trim();
      continue;
    }
    // apply_patch accepts context-only @@ markers without ranges. Rebuild one
    // valid hunk below so PatchDiff can render either form consistently.
    if (line.startsWith("@@")) continue;
    current.body.push(toPrefixedDiffLine(line));
  }

  flush();
  return previews.length > 0 ? previews : [{ filePath: "", patch: "" }];
}

function normalizeRawDiff(
  raw: string,
  filePath: string,
  kind: ApprovalDiffKind,
): string {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  if (/^diff --git /m.test(normalized) || /^--- .+\n\+\+\+ /m.test(normalized)) {
    return normalizePatchForPatchDiff(normalized, filePath || undefined);
  }

  const fileName = patchFileName(filePath);
  if (/^@@ /m.test(normalized)) {
    const headers = fileHeaders(fileName, kind);
    return normalizePatchForPatchDiff(
      [
        `diff --git a/${fileName} b/${fileName}`,
        ...headers,
        normalized,
      ].join("\n"),
      filePath || undefined,
    );
  }

  const body = normalized
    .split("\n")
    .filter((line) => !isDiffMetadata(line))
    .map(toPrefixedDiffLine);
  return buildUnifiedDiff(body, filePath, kind);
}

function isDiffMetadata(line: string): boolean {
  return (
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("diff --git ")
  );
}

function toPrefixedDiffLine(line: string): string {
  if (
    line.startsWith("+") ||
    line.startsWith("-") ||
    line.startsWith(" ") ||
    line.startsWith("\\")
  ) {
    return line;
  }
  return ` ${line}`;
}

function buildUnifiedDiff(
  lines: string[],
  filePath: string,
  kind: ApprovalDiffKind,
): string {
  if (lines.length === 0) return "";

  let oldCount = 0;
  let newCount = 0;
  for (const line of lines) {
    if (line.startsWith("+")) newCount++;
    else if (line.startsWith("-")) oldCount++;
    else if (!line.startsWith("\\")) {
      oldCount++;
      newCount++;
    }
  }

  const fileName = patchFileName(filePath);
  const oldStart = kind === "write" ? 0 : 1;
  const newStart = kind === "delete" ? 0 : 1;
  return normalizePatchForPatchDiff(
    [
      `diff --git a/${fileName} b/${fileName}`,
      ...fileHeaders(fileName, kind),
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...lines,
    ].join("\n"),
    filePath || undefined,
  );
}

function fileHeaders(fileName: string, kind: ApprovalDiffKind): string[] {
  if (kind === "write") {
    return ["new file mode 100644", "--- /dev/null", `+++ b/${fileName}`];
  }
  if (kind === "delete") {
    return [`--- a/${fileName}`, "+++ /dev/null"];
  }
  return [`--- a/${fileName}`, `+++ b/${fileName}`];
}

function patchFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").trim();
  return normalized.split("/").filter(Boolean).pop() || "file";
}
