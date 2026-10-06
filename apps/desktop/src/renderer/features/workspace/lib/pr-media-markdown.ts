import { mapPrAttachmentUrls, prAttachmentUrl } from "@mains/contracts/pr-attachments";

export interface PrEditorSelection { value: string; start: number; end: number }
export interface PrMarkdownMedia { id: string; name: string; type: string }

function mediaLabel(name: string) {
  return name.replace(/\\/g, "\\\\").replace(/\[|\]/g, "\\$&")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "&#124;")
    .replace(/[\r\n]/g, " ");
}

/** Replace the saved selection without introducing new rows inside a comparison table. */
export function insertPrMedia(value: string, selection: PrEditorSelection, media: PrMarkdownMedia[]) {
  let start = selection.value === value ? Math.min(selection.start, value.length) : value.length;
  let end = selection.value === value ? Math.min(selection.end, value.length) : value.length;
  // A template slot is an HTML comment. Inserting inside it would hide the media from both previews and gh.
  for (const comment of value.matchAll(/<!--[\s\S]*?-->/g)) {
    if (start >= comment.index! && start < comment.index! + comment[0].length && end <= comment.index! + comment[0].length) {
      start = comment.index!;
      end = start + comment[0].length;
      break;
    }
  }
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", end);
  const inTable = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd).includes("|");
  const references = media.map((asset) => {
    // A video embed alone becomes a GitHub player; inside a table use a clickable link.
    const embed = asset.type.startsWith("image/") || !inTable;
    return `${embed ? "!" : ""}[${mediaLabel(asset.name)}](${prAttachmentUrl(asset.id)})`;
  }).join(inTable ? " <br> " : "\n\n");
  const prefix = value.slice(0, start);
  const suffix = value.slice(end);
  const before = inTable ? (start > 0 && !/\s/.test(value[start - 1]) ? " " : "")
    : (!prefix || prefix.endsWith("\n\n") ? "" : prefix.endsWith("\n") ? "\n" : "\n\n");
  const after = inTable ? (end < value.length && !/\s/.test(value[end]) ? " " : "")
    : (!suffix || suffix.startsWith("\n\n") ? "" : suffix.startsWith("\n") ? "\n" : "\n\n");
  const inserted = before + references + after;
  let next = prefix + inserted + suffix;
  if (inTable) {
    // Table video links retain their cell; one standalone embed below the table supplies the player.
    const players = media.filter((asset) => !asset.type.startsWith("image/"))
      .map((asset) => `![${mediaLabel(asset.name)}](${prAttachmentUrl(asset.id)})`)
      .filter((embed, index, all) => !next.includes(embed) && all.indexOf(embed) === index);
    if (players.length) {
      let tableEnd = next.indexOf("\n", start + inserted.length);
      while (tableEnd >= 0) {
        const endOfNextLine = next.indexOf("\n", tableEnd + 1);
        if (!next.slice(tableEnd + 1, endOfNextLine < 0 ? next.length : endOfNextLine).trimStart().startsWith("|")) break;
        tableEnd = endOfNextLine;
      }
      if (tableEnd < 0) tableEnd = next.length;
      const remainder = next.slice(tableEnd);
      next = next.slice(0, tableEnd) + "\n\n" + players.join("\n\n")
        + (remainder && !remainder.startsWith("\n\n") ? "\n" : "") + remainder;
    }
  }
  return { value: next, start: start + inserted.length, end: start + inserted.length };
}

/** Remove every generated reference when the draft's underlying File is removed. */
export function removePrMedia(value: string, id: string) {
  const url = prAttachmentUrl(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`!?\\[(?:\\\\.|[^\\]\\\\])*\\]\\(<?${url}>?\\)`, "g"), "");
}

/** The same body survives staging; only the disposable draft identities change. */
export function stagePrMediaReferences(body: string, draftIds: string[], uploadIds: string[]) {
  const uploaded = new Map(draftIds.map((id, index) => [id, uploadIds[index]]));
  return mapPrAttachmentUrls(body, (id) => {
    const uploadId = uploaded.get(id);
    if (!uploadId) throw new Error("A referenced PR attachment is missing. Add the file again or remove its reference.");
    return prAttachmentUrl(uploadId);
  });
}
