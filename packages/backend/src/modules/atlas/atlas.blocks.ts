import type { PartialBlock } from "@blocknote/core";

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
let editorPromise: Promise<import("@blocknote/server-util").ServerBlockNoteEditor> | null = null;
function serverEditor() {
  editorPromise ??= import("@blocknote/server-util").then(({ ServerBlockNoteEditor }) => ServerBlockNoteEditor.create());
  return editorPromise;
}
/** JSON is canonical; Markdown is an interoperability projection. */
export async function pageContent(input: { blocks?: unknown[]; markdown?: string }) {
  if (input.blocks !== undefined && input.markdown !== undefined) throw new Error("Supply blocks or Markdown, not both");
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_PAGE_BYTES) throw new Error("Page exceeds the 2 MB limit");
  const editor = await serverEditor();
  const blocks = input.markdown !== undefined
    ? await editor.tryParseMarkdownToBlocks(input.markdown)
    : input.blocks ?? [{ type: "paragraph", content: [] }];
  if (!Array.isArray(blocks) || !blocks.length) throw new Error("Page must contain at least one block");
  const fileIds = new Set<string>();
  const seenIds = new Set<string>();
  let count = 0;
  const visit = (rows: unknown[], depth: number) => {
    if (depth > 20) throw new Error("Page blocks are nested too deeply");
    for (const row of rows) {
      if (++count > 2000 || !row || typeof row !== "object") throw new Error("Invalid page blocks");
      const block = row as { id?: unknown; type?: unknown; props?: { url?: unknown }; children?: unknown };
      if (typeof block.type !== "string" || !Object.prototype.hasOwnProperty.call(editor.editor.schema.blockSchema, block.type)) throw new Error("Unsupported page block");
      if (block.id !== undefined) {
        if (typeof block.id !== "string" || seenIds.has(block.id)) throw new Error("Duplicate or invalid block ID");
        seenIds.add(block.id);
      }
      const url = block.props?.url;
      if (typeof url === "string" && url) {
        if (url.startsWith("atlas-file://")) {
          const id = url.slice("atlas-file://".length);
          if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid embedded Atlas file");
          fileIds.add(id);
        } else if (!/^https?:\/\//.test(url)) throw new Error("Upload local files before adding them to a page");
      }
      if (block.children !== undefined) {
        if (!Array.isArray(block.children)) throw new Error("Invalid nested blocks");
        visit(block.children, depth + 1);
      }
    }
  };
  visit(blocks, 0);
  // The library validates inline content and table structures during conversion.
  const markdown = await editor.blocksToMarkdownLossy(blocks as PartialBlock[]);
  return { blocks, markdown, fileIds: [...fileIds] };
}
