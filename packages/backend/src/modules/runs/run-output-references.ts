import os from "node:os";
import path from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { localFileReference } from "@mains/contracts/local-file-reference";
import { OUTPUT_DOCUMENT_TYPES, OUTPUT_IMAGE_EXTENSIONS } from "@mains/contracts/output-files";

export function resolveOutputReference(reference: string, root: string | null): string | null {
  let value = localFileReference(reference)?.path;
  if (!value) return null;
  if (value.startsWith("~/")) value = path.join(os.homedir(), value.slice(2));
  return path.isAbsolute(value) ? path.resolve(value) : root ? path.resolve(root, value) : null;
}

/** Persisted paths and tool arguments are filesystem names, not URLs. */
export function resolveOutputFilePath(reference: string, root: string | null): string | null {
  let value = reference;
  if (!value || value.includes("\0") || value.length > 4096) return null;
  if (/^file:/i.test(value)) return resolveOutputReference(value, root);
  if (/^[a-z][\w+.-]*:/i.test(value)) return null;
  if (value.startsWith("~/")) value = path.join(os.homedir(), value.slice(2));
  return path.isAbsolute(value) ? path.resolve(value) : root ? path.resolve(root, value) : null;
}

interface Node { type: string; value?: string; url?: string; identifier?: string; children?: Node[] }
/** Structured destinations are visited once. Only prose is scanned for bare
 * paths, so a filename inside a link or code span cannot name a second file. */
export function outputReferences(text: string, root: string | null) {
  const files = new Set<string>();
  const embedded = new Set<string>();
  const tree = fromMarkdown(text);
  const definitions = new Map(tree.children.filter((node) => node.type === "definition")
    .map((node) => [node.identifier, node.url]));
  const add = (value: string, image = false, literal = false) => {
    if (files.size >= 500) return;
    const file = literal ? resolveOutputFilePath(value, root) : resolveOutputReference(value, root);
    if (!file) return;
    const extension = path.extname(file).slice(1).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(OUTPUT_DOCUMENT_TYPES, extension) && !OUTPUT_IMAGE_EXTENSIONS.has(extension)) return;
    files.add(file);
    if (image) embedded.add(file);
  };
  const visit = (node: Node) => {
    if (node.type === "link" || node.type === "image") { if (node.url) add(node.url, node.type === "image"); return; }
    if (node.type === "linkReference" || node.type === "imageReference") {
      const url = node.identifier && definitions.get(node.identifier);
      if (url) add(url, node.type === "imageReference");
      return;
    }
    if (node.type === "definition" || node.type === "code" || node.type === "html") return;
    if (node.type === "inlineCode") { if (node.value) add(node.value, false, true); return; }
    if (node.type === "text" && node.value) {
      let value = node.value.replace(/(?:https?:\/\/|[a-z][\w+.-]*:\/\/)[^\s<>"'`]+/gi, "");
      value = value.replace(/"([^"\n]+)"|'([^'\n]+)'/g, (match, double, single) => { add(double ?? single, false, true); return " ".repeat(match.length); });
      add(value);
      for (const match of value.matchAll(/[^\s`"'<>()[\]{}=,;]+/g)) add(match[0].replace(/[.,;!?]+$/, ""));
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return { files, embedded };
}
