import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown-components";
import { FileIconComponent } from "@/components/ui/icons";
import { Sparkles } from "@/components/ui/icons";
import { applySignedSrc } from "@/lib/local-image-url";
import { useIsMobile, isWeb } from "@/lib/platform";
import Text from "../text";

const sparklesIconMarkup = renderToStaticMarkup(<Sparkles className="w-3 h-3 shrink-0" />);

export interface RichSkillChipData {
  name: string;
  displayName?: string;
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
}

export interface RichFileChipData {
  /** Unique path used as chip identity and serialized as `@<path>`. */
  path: string;
  /** Short label rendered inside the chip. */
  basename: string;
}

export interface RichCodeChipData {
  /** Unique key used as chip identity and serialized as `@<key>` (`<path>#L<start>-<end>`). */
  key: string;
  /** Basename used to pick the file-type icon. */
  fileName: string;
  /** Short label rendered inside the chip (`file.ts:19-24`). */
  label: string;
}

export type RichTriggerChar = "/" | "@" | "#" | "$";

export interface RichInputFormHandle {
  focus: () => void;
  /** Replace a leading "<trigger><filter>" token at the caret with an inline skill chip + trailing space. */
  replaceTokenWithSkillChip: (
    triggerChar: "$" | "@" | "/",
    skill: RichSkillChipData,
  ) => void;
  /** Replace a leading "<trigger><filter>" token at the caret with an inline file chip + trailing space. Returns false if the caret was not in a text node (e.g. after focus moved to a dropdown) — caller should fall back to rewriting the query string with `@<path> ` so the sync effect can rebuild the chip. */
  replaceTokenWithFileChip: (
    triggerChar: "@" | "/",
    file: RichFileChipData,
  ) => boolean;
  /** Replace a leading "<trigger><filter>" token at the caret with the given plain-text replacement. Returns false if the caret was not in a text node (e.g. after focus moved to a dropdown). */
  replaceTokenWithText: (triggerChar: RichTriggerChar, replacement: string) => boolean;
}

interface RichInputFormProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  /**
   * While true, Enter neither submits nor inserts a line — the text stays put,
   * as it does when the toolbar's send button has become Stop.
   */
  submitDisabled?: boolean;
  onSkillChipsChange?: (names: string[]) => void;
  onFileChipsChange?: (paths: string[]) => void;
  onCodeChipsChange?: (keys: string[]) => void;
  /** Fires whenever the caret moves or content changes; receives the serialized text from start to caret. */
  onCaretContextChange?: (textBeforeCaret: string) => void;
  placeholder?: string;
  /** Maps skill name → display data so `$<name>` tokens can be rebuilt as chips when query changes externally. */
  skillChipMap?: ReadonlyMap<string, RichSkillChipData>;
  /** Maps file path → display data so `@<path>` tokens can be rebuilt as chips when query changes externally. */
  fileChipMap?: ReadonlyMap<string, RichFileChipData>;
  /** Maps code-selection key → display data so `@<path>#L<range>` tokens can be rebuilt as chips when query changes externally. */
  codeChipMap?: ReadonlyMap<string, RichCodeChipData>;
}

const CHIP_ATTR = "data-skill-chip";
const CHIP_NAME_ATTR = "data-skill-name";
const FILE_CHIP_ATTR = "data-file-chip";
const FILE_PATH_ATTR = "data-file-path";
const CODE_CHIP_ATTR = "data-code-chip";
const CODE_KEY_ATTR = "data-code-key";
const CHIP_KEY_SEP = "";

const composerMarkdownComponents: Components = {
  ...markdownComponents,
  // Reading-mode links trigger navigation. Inside a contenteditable they must
  // remain editable text while retaining enough metadata to serialize back.
  a: ({ href, children }) => (
    <span
      data-markdown-link={href ?? ""}
      className="text-primary-600 underline dark:text-primary-400"
    >
      {children}
    </span>
  ),
  // Do not initiate a network request merely because Markdown was pasted.
  img: ({ src, alt }) => (
    <span
      data-markdown-image-src={typeof src === "string" ? src : ""}
      data-markdown-image-alt={alt ?? ""}
      className="inline-flex rounded-lg bg-primary-200/40 px-2 py-1 text-xs text-primary-600 dark:bg-primary/10 dark:text-primary-400"
    >
      {alt?.trim() || "Image"}
    </span>
  ),
};

function looksLikeMarkdownSource(text: string): boolean {
  return (
    /(^|\n)\s*(?:#{1,6}\s|\x60{3}|~~~|>\s|[-*+]\s|\d+\.\s|\|.+\|\s*$)/m.test(
      text,
    ) ||
    /(?:\x60[^\x60\n]+\x60|\*\*[^*\n]+\*\*|__[^_\n]+__|!?\[[^\]\n]+\]\([^)]+\))/.test(
      text,
    )
  );
}

function buildMarkdownFragment(text: string): DocumentFragment {
  const markup = renderToStaticMarkup(
    <ReactMarkdown
      components={composerMarkdownComponents}
      remarkPlugins={[remarkGfm]}
    >
      {text}
    </ReactMarkdown>,
  );
  const template = document.createElement("template");
  template.innerHTML = markup;
  removeRendererWhitespace(template.content);
  return template.content;
}

const MARKDOWN_BLOCK_TAGS = new Set([
  "BLOCKQUOTE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "OL",
  "P",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/**
 * React's static renderer inserts formatting newlines between block elements.
 * The composer intentionally preserves whitespace for ordinary text, so those
 * implementation-only text nodes would otherwise become visible blank lines.
 */
function removeRendererWhitespace(fragment: DocumentFragment) {
  const containers: ParentNode[] = [
    fragment,
    ...Array.from(fragment.querySelectorAll("*")),
  ];
  for (const container of containers) {
    const containsMarkdownBlocks =
      container === fragment ||
      Array.from(container.children).some((child) =>
        MARKDOWN_BLOCK_TAGS.has(child.tagName),
      );
    if (!containsMarkdownBlocks) continue;

    for (const child of Array.from(container.childNodes)) {
      if (
        child.nodeType === Node.TEXT_NODE &&
        /^\s+$/.test(child.textContent ?? "") &&
        /[\r\n]/.test(child.textContent ?? "")
      ) {
        container.removeChild(child);
      }
    }
  }
}

function buildChip(skill: RichSkillChipData): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.setAttribute(CHIP_ATTR, "true");
  chip.setAttribute(CHIP_NAME_ATTR, skill.name);
  chip.contentEditable = "false";
  // Fixed height + leading-none + align-middle so the line box height stays constant
  // regardless of whether the chip carries an icon — keeps the caret height consistent.
  chip.className =
    "inline-flex align-middle items-center gap-1 px-1.5 mb-0.5 h-6 mx-0.5 rounded-lg text-xs font-medium leading-none select-none " +
    "bg-primary dark:bg-primary-300/10 dark:text-primary-200 " +
    " cursor-default";

  // Icon slot is always present (even as an empty 14×14 spacer) so chip width/height stay stable.
  const iconSlot = document.createElement("span");
  iconSlot.className =
    "inline-flex items-center justify-center size-3.5 shrink-0 rounded-sm overflow-hidden";

  const iconPath = skill.iconLarge || skill.iconSmall;
  if (iconPath) {
    const img = document.createElement("img");
    img.alt = "";
    img.className = "size-full object-contain";
    if (skill.brandColor) {
      img.style.backgroundColor = skill.brandColor;
    }
    img.draggable = false;
    img.onerror = () => {
      // Swap to the Sparkles placeholder so a missing asset doesn't render a broken-image glyph.
      img.remove();
      iconSlot.innerHTML = sparklesIconMarkup;
    };
    iconSlot.appendChild(img);
    applySignedSrc(img, iconPath);
  } else {
    iconSlot.innerHTML = sparklesIconMarkup;
  }
  chip.appendChild(iconSlot);

  const label = document.createElement("span");
  label.className = "leading-none";
  label.textContent = skill.displayName || skill.name;
  chip.appendChild(label);

  return chip;
}

const fileIconMarkupCache = new Map<string, string>();

function getFileIconMarkup(basename: string): string {
  const cacheKey = basename;
  const cached = fileIconMarkupCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const dotIdx = basename.lastIndexOf(".");
  const extension = dotIdx > 0 && dotIdx < basename.length - 1 ? basename.slice(dotIdx + 1) : undefined;
  const markup = renderToStaticMarkup(
    <FileIconComponent extension={extension} fileName={basename} className="size-3.5" />,
  );
  fileIconMarkupCache.set(cacheKey, markup);
  return markup;
}

function buildFileChip(file: RichFileChipData): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.setAttribute(FILE_CHIP_ATTR, "true");
  chip.setAttribute(FILE_PATH_ATTR, file.path);
  chip.contentEditable = "false";
  chip.title = file.path;
  chip.className =
    "inline-flex align-middle items-center gap-1 px-1.5 mb-0.5 h-6 mx-0.5 rounded-lg text-xs font-medium leading-none select-none " +
    "bg-primary dark:bg-primary-300/10 dark:text-primary-200 cursor-default";

  const iconSlot = document.createElement("span");
  iconSlot.className = "inline-flex items-center justify-center size-3.5 shrink-0";
  iconSlot.innerHTML = getFileIconMarkup(file.basename);
  chip.appendChild(iconSlot);

  const label = document.createElement("span");
  label.className = "leading-none";
  label.textContent = file.basename;
  chip.appendChild(label);

  return chip;
}

function buildCodeChip(code: RichCodeChipData): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.setAttribute(CODE_CHIP_ATTR, "true");
  chip.setAttribute(CODE_KEY_ATTR, code.key);
  chip.contentEditable = "false";
  chip.title = code.key;
  chip.className =
    "inline-flex align-middle items-center gap-1 px-1.5 mb-0.5 h-6 mx-0.5 rounded-lg text-xs font-medium leading-none select-none " +
    "bg-primary dark:bg-primary-300/10 dark:text-primary-200 cursor-default";

  const iconSlot = document.createElement("span");
  iconSlot.className = "inline-flex items-center justify-center size-3.5 shrink-0";
  iconSlot.innerHTML = getFileIconMarkup(code.fileName);
  chip.appendChild(iconSlot);

  const label = document.createElement("span");
  label.className = "leading-none";
  label.textContent = code.label;
  chip.appendChild(label);

  return chip;
}

/**
 * The last node in document order inside `root` — used to spot the filler `<br>` browsers
 * leave behind in an emptied contenteditable so it does not serialize as a real newline.
 */
function lastLeaf(root: HTMLElement): Node | null {
  let node: Node | null = root.lastChild;
  if (!node) return null;
  while (node.lastChild) node = node.lastChild;
  return node;
}

function serializeChildren(node: Node, filler: Node | null): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (
      child instanceof HTMLElement &&
      child.tagName === "DIV" &&
      out.length > 0 &&
      !out.endsWith("\n")
    ) {
      out += "\n";
    }
    out += serializeEditorNode(child, filler);
  }
  return out;
}

function serializeTable(table: HTMLTableElement, filler: Node | null): string {
  const rows = Array.from(table.rows);
  if (rows.length === 0) return "";
  const row = (cells: HTMLCollectionOf<HTMLTableCellElement>) =>
    "| " +
    Array.from(cells)
      .map((cell) =>
        serializeChildren(cell, filler)
          .trim()
          .replace(/\|/g, "\\|")
          .replace(/\n+/g, "<br>"),
      )
      .join(" | ") +
    " |";
  const header = rows[0];
  const separator =
    "| " + Array.from(header.cells, () => "---").join(" | ") + " |";
  return [row(header.cells), separator, ...rows.slice(1).map((r) => row(r.cells))].join(
    "\n",
  );
}

function serializeList(
  list: HTMLOListElement | HTMLUListElement,
  filler: Node | null,
): string {
  const ordered = list.tagName === "OL";
  const start = ordered ? Number(list.getAttribute("start") ?? "1") : 1;
  const items = Array.from(list.children).filter(
    (child): child is HTMLLIElement => child.tagName === "LI",
  );

  return items
    .map((item, index) => {
      const nested = Array.from(item.children).filter(
        (child) => child.tagName === "UL" || child.tagName === "OL",
      );
      let content = Array.from(item.childNodes)
        .filter((child) => !nested.includes(child as Element))
        .map((child) => serializeEditorNode(child, filler))
        .join("")
        .trim()
        .replace(/\n{2,}/g, "\n");
      const marker = ordered ? String(start + index) + ". " : "- ";
      content = content.replace(/\n/g, "\n" + " ".repeat(marker.length));
      let output = marker + content;
      for (const child of nested) {
        const nestedText = serializeEditorNode(child, filler).trimEnd();
        output +=
          "\n" +
          nestedText
            .split("\n")
            .map((line) => "  " + line)
            .join("\n");
      }
      return output;
    })
    .join("\n");
}

function serializeEditorNode(node: Node, filler: Node | null): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) {
    return serializeChildren(node, filler);
  }

  if (node.getAttribute(CHIP_ATTR) === "true") {
    return "$" + (node.getAttribute(CHIP_NAME_ATTR) ?? "");
  }
  if (node.getAttribute(FILE_CHIP_ATTR) === "true") {
    return "@" + (node.getAttribute(FILE_PATH_ATTR) ?? "");
  }
  if (node.getAttribute(CODE_CHIP_ATTR) === "true") {
    return "@" + (node.getAttribute(CODE_KEY_ATTR) ?? "");
  }

  const children = () => serializeChildren(node, filler);
  switch (node.tagName) {
    case "BR":
      return node === filler ? "" : "\n";
    case "P":
      return children() + "\n\n";
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6": {
      const level = Number(node.tagName.slice(1));
      return "#".repeat(level) + " " + children() + "\n\n";
    }
    case "STRONG":
    case "B":
      return "**" + children() + "**";
    case "EM":
    case "I":
      return "*" + children() + "*";
    case "S":
    case "DEL":
      return "~~" + children() + "~~";
    case "CODE": {
      if (node.parentElement?.tagName === "PRE") return node.textContent ?? "";
      const value = node.textContent ?? "";
      const tick = String.fromCharCode(96);
      const longestRun = Math.max(
        0,
        ...(value.match(/\x60+/g) ?? []).map((run) => run.length),
      );
      const fence = tick.repeat(Math.max(1, longestRun + 1));
      return fence + value + fence;
    }
    case "PRE": {
      const code = node.querySelector("code");
      const value = code?.textContent ?? node.textContent ?? "";
      const language =
        code?.className.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? "";
      const tick = String.fromCharCode(96);
      const longestRun = Math.max(
        0,
        ...(value.match(/\x60{3,}/g) ?? []).map((run) => run.length),
      );
      const fence = tick.repeat(Math.max(3, longestRun + 1));
      return (
        fence +
        language +
        "\n" +
        value.replace(/\n$/, "") +
        "\n" +
        fence +
        "\n\n"
      );
    }
    case "UL":
    case "OL":
      return (
        serializeList(node as HTMLUListElement | HTMLOListElement, filler) +
        "\n\n"
      );
    case "BLOCKQUOTE": {
      const value = children().trim();
      return (
        value
          .split("\n")
          .map((line) => "> " + line)
          .join("\n") + "\n\n"
      );
    }
    case "TABLE":
      return serializeTable(node as HTMLTableElement, filler) + "\n\n";
    case "A": {
      const href = node.getAttribute("href") ?? "";
      return "[" + children() + "](" + href + ")";
    }
    case "HR":
      return "---\n\n";
    case "IMG": {
      const src = node.getAttribute("src") ?? "";
      const alt = node.getAttribute("alt") ?? "";
      return "![" + alt + "](" + src + ")";
    }
    case "INPUT":
      return node.getAttribute("type") === "checkbox"
        ? node.hasAttribute("checked")
          ? "[x] "
          : "[ ] "
        : "";
    case "SPAN": {
      const href = node.getAttribute("data-markdown-link");
      if (href !== null) return "[" + children() + "](" + href + ")";
      const imageSrc = node.getAttribute("data-markdown-image-src");
      if (imageSrc !== null) {
        const alt = node.getAttribute("data-markdown-image-alt") ?? "";
        return "![" + alt + "](" + imageSrc + ")";
      }
      return children();
    }
    default:
      return children();
  }
}

/**
 * Serialize editable rich Markdown back to the source text sent to providers.
 * Composer chips keep their established token forms.
 */
function serializeRoot(root: HTMLElement): string {
  // Deleting the last character leaves a filler BR behind; counting it as a
  // newline would keep the editor permanently non-empty.
  return serializeChildren(root, lastLeaf(root));
}

function rebuildContent(
  root: HTMLElement,
  text: string,
  skillChipMap?: ReadonlyMap<string, RichSkillChipData>,
  fileChipMap?: ReadonlyMap<string, RichFileChipData>,
  codeChipMap?: ReadonlyMap<string, RichCodeChipData>,
) {
  while (root.firstChild) root.removeChild(root.firstChild);
  if (text.length === 0) return;
  root.appendChild(
    looksLikeMarkdownSource(text)
      ? buildMarkdownFragment(text)
      : document.createTextNode(text),
  );

  const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const skillNames =
    skillChipMap && skillChipMap.size > 0
      ? Array.from(skillChipMap.keys()).sort((a, b) => b.length - a.length)
      : [];
  const filePaths =
    fileChipMap && fileChipMap.size > 0
      ? Array.from(fileChipMap.keys()).sort((a, b) => b.length - a.length)
      : [];
  const codeKeys =
    codeChipMap && codeChipMap.size > 0
      ? Array.from(codeChipMap.keys()).sort((a, b) => b.length - a.length)
      : [];

  if (skillNames.length === 0 && filePaths.length === 0 && codeKeys.length === 0) {
    return;
  }

  // Longer paths sorted first so `@src/foo.tsx.bak` wins over `@src/foo.tsx` when both are present.
  const parts: string[] = [];
  if (skillNames.length > 0) {
    parts.push(`\\$(?<skill>${skillNames.map(escRe).join("|")})(?![\\w-])`);
  }
  // Code keys (`<path>#L<range>`) go before file paths: both start with `@` and a
  // code key extends a path, so the file alternative would otherwise win at `@path`.
  if (codeKeys.length > 0) {
    parts.push(`@(?<code>${codeKeys.map(escRe).join("|")})(?![\\w-])`);
  }
  if (filePaths.length > 0) {
    // Negative lookahead allows path chars (`.`, `/`, `-`, `_`, word) so we don't partial-match a longer path.
    parts.push(`@(?<file>${filePaths.map(escRe).join("|")})(?![\\w./-])`);
  }
  const re = new RegExp(parts.join("|"), "g");

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) textNodes.push(current as Text);

  for (const textNode of textNodes) {
    if (textNode.parentElement?.closest("code, [data-markdown-link]")) continue;
    const value = textNode.data;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let matched = false;
    let match: RegExpExecArray | null;
    re.lastIndex = 0;

    while ((match = re.exec(value)) !== null) {
      matched = true;
      if (match.index > lastIndex) {
        fragment.appendChild(
          document.createTextNode(value.slice(lastIndex, match.index)),
        );
      }
      const skillName = match.groups?.skill;
      const filePath = match.groups?.file;
      const codeKey = match.groups?.code;
      if (skillName) {
        const data = skillChipMap!.get(skillName);
        fragment.appendChild(
          data ? buildChip(data) : document.createTextNode(match[0]),
        );
      } else if (codeKey) {
        const data = codeChipMap!.get(codeKey);
        fragment.appendChild(
          data ? buildCodeChip(data) : document.createTextNode(match[0]),
        );
      } else if (filePath) {
        const data = fileChipMap!.get(filePath);
        fragment.appendChild(
          data ? buildFileChip(data) : document.createTextNode(match[0]),
        );
      }
      lastIndex = match.index + match[0].length;
    }

    if (!matched) continue;
    if (lastIndex < value.length) {
      fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
    }
    textNode.replaceWith(fragment);
  }
}

function serializeFragment(node: Node): string {
  return node instanceof HTMLElement
    ? serializeEditorNode(node, null)
    : serializeChildren(node, null);
}

function getTextBeforeCaret(root: HTMLElement): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  const before = document.createRange();
  before.setStart(root, 0);
  before.setEnd(range.endContainer, range.endOffset);
  const fragment = before.cloneContents();
  return serializeFragment(fragment);
}

/**
 * Find the most recent `triggerChar` before the caret and replace [trigger..caret] with
 * either a chip + trailing space, or a plain-text replacement. Returns true on success.
 */
function replaceTokenAtCaret(
  root: HTMLElement,
  triggerChar: string,
  replacement: { kind: "text"; value: string } | { kind: "chip"; chip: HTMLElement },
): boolean {
  root.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return false;
  const node = range.endContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.textContent ?? "";
  const offset = range.endOffset;
  const before = text.slice(0, offset);
  const triggerIdx = before.lastIndexOf(triggerChar);
  if (triggerIdx < 0) return false;

  const tokenRange = document.createRange();
  tokenRange.setStart(node, triggerIdx);
  tokenRange.setEnd(node, offset);
  tokenRange.deleteContents();

  if (replacement.kind === "text") {
    const txt = document.createTextNode(replacement.value);
    tokenRange.insertNode(txt);
    const after = document.createRange();
    after.setStartAfter(txt);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  } else {
    const space = document.createTextNode(" ");
    tokenRange.insertNode(space);
    tokenRange.insertNode(replacement.chip);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }
  return true;
}

function collectChipNames(root: HTMLElement): string[] {
  const names: string[] = [];
  for (const el of Array.from(root.querySelectorAll(`[${CHIP_ATTR}="true"]`))) {
    const name = el.getAttribute(CHIP_NAME_ATTR);
    if (name) names.push(name);
  }
  return names;
}

function collectFileChipPaths(root: HTMLElement): string[] {
  const paths: string[] = [];
  for (const el of Array.from(root.querySelectorAll(`[${FILE_CHIP_ATTR}="true"]`))) {
    const p = el.getAttribute(FILE_PATH_ATTR);
    if (p) paths.push(p);
  }
  return paths;
}

function collectCodeChipKeys(root: HTMLElement): string[] {
  const keys: string[] = [];
  for (const el of Array.from(root.querySelectorAll(`[${CODE_CHIP_ATTR}="true"]`))) {
    const k = el.getAttribute(CODE_KEY_ATTR);
    if (k) keys.push(k);
  }
  return keys;
}

export const RichInputForm = forwardRef<RichInputFormHandle, RichInputFormProps>(
  function RichInputForm(
    {
      query,
      onQueryChange,
      onSubmit,
      submitDisabled = false,
      onSkillChipsChange,
      onFileChipsChange,
      onCodeChipsChange,
      onCaretContextChange,
      placeholder,
      skillChipMap,
      fileChipMap,
      codeChipMap,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const [isEmpty, setIsEmpty] = useState(query.length === 0);
    // The ⌘P focus hint is keyboard-only — useless (and overlaps the placeholder)
    // on touch/mobile and in the browser.
    const showFocusHint = !useIsMobile() && !isWeb;
    // Sentinel that no real query string can equal — forces an initial DOM rebuild on mount.
    const lastSerializedRef = useRef<string>(" __rif_init__");
    const lastChipsRef = useRef<string>("");
    const lastFileChipsRef = useRef<string>("");
    const lastCodeChipsRef = useRef<string>("");
    const skillChipMapRef = useRef<ReadonlyMap<string, RichSkillChipData> | undefined>(skillChipMap);
    const fileChipMapRef = useRef<ReadonlyMap<string, RichFileChipData> | undefined>(fileChipMap);
    const codeChipMapRef = useRef<ReadonlyMap<string, RichCodeChipData> | undefined>(codeChipMap);
    useEffect(() => {
      skillChipMapRef.current = skillChipMap;
    }, [skillChipMap]);
    useEffect(() => {
      fileChipMapRef.current = fileChipMap;
    }, [fileChipMap]);
    useEffect(() => {
      codeChipMapRef.current = codeChipMap;
    }, [codeChipMap]);

    const fireCaretContext = useCallback(() => {
      if (!onCaretContextChange) return;
      const root = editorRef.current;
      if (!root) return;
      const before = getTextBeforeCaret(root);
      if (before === null) return;
      onCaretContextChange(before);
    }, [onCaretContextChange]);

    // Re-evaluate caret context on caret moves without input (arrow keys, mouse clicks).
    useEffect(() => {
      if (!onCaretContextChange) return;
      const handler = () => {
        const root = editorRef.current;
        if (!root) return;
        if (document.activeElement !== root) return;
        fireCaretContext();
      };
      document.addEventListener("selectionchange", handler);
      return () => document.removeEventListener("selectionchange", handler);
    }, [onCaretContextChange, fireCaretContext]);

    const fireChange = useCallback(() => {
      const root = editorRef.current;
      if (!root) return;
      const text = serializeRoot(root);
      lastSerializedRef.current = text;
      setIsEmpty(text.length === 0);
      if (text !== query) onQueryChange(text);

      if (onSkillChipsChange) {
        const names = collectChipNames(root);
        const key = names.join(CHIP_KEY_SEP);
        if (key !== lastChipsRef.current) {
          lastChipsRef.current = key;
          onSkillChipsChange(names);
        }
      }

      if (onFileChipsChange) {
        const paths = collectFileChipPaths(root);
        const key = paths.join(CHIP_KEY_SEP);
        if (key !== lastFileChipsRef.current) {
          lastFileChipsRef.current = key;
          onFileChipsChange(paths);
        }
      }

      if (onCodeChipsChange) {
        const keys = collectCodeChipKeys(root);
        const key = keys.join(CHIP_KEY_SEP);
        if (key !== lastCodeChipsRef.current) {
          lastCodeChipsRef.current = key;
          onCodeChipsChange(keys);
        }
      }

      fireCaretContext();
    }, [onQueryChange, onSkillChipsChange, onFileChipsChange, onCodeChipsChange, query, fireCaretContext]);

    // Sync DOM when external `query` differs from current serialization.
    // Only fires on real divergence (slash/file/issue picker rewrites the goal); typing leaves them in lockstep.
    useEffect(() => {
      const root = editorRef.current;
      if (!root) return;
      if (query === lastSerializedRef.current) return;
      rebuildContent(root, query, skillChipMapRef.current, fileChipMapRef.current, codeChipMapRef.current);
      lastSerializedRef.current = query;
      setIsEmpty(query.length === 0);

      const names = collectChipNames(root);
      lastChipsRef.current = names.join(CHIP_KEY_SEP);
      onSkillChipsChange?.(names);

      const paths = collectFileChipPaths(root);
      lastFileChipsRef.current = paths.join(CHIP_KEY_SEP);
      onFileChipsChange?.(paths);

      const codeKeys = collectCodeChipKeys(root);
      lastCodeChipsRef.current = codeKeys.join(CHIP_KEY_SEP);
      onCodeChipsChange?.(codeKeys);

      if (document.activeElement === root) placeCaretAtEnd(root);
    }, [query, onSkillChipsChange, onFileChipsChange, onCodeChipsChange]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        replaceTokenWithSkillChip: (triggerChar, skill) => {
          const root = editorRef.current;
          if (!root) return;
          const chip = buildChip(skill);
          if (replaceTokenAtCaret(root, triggerChar, { kind: "chip", chip })) {
            fireChange();
            return;
          }
          // No matching trigger before the caret — insert chip wherever the caret sits, or at end.
          root.focus();
          const sel = window.getSelection();
          if (
            !sel ||
            sel.rangeCount === 0 ||
            !root.contains(sel.getRangeAt(0).endContainer)
          ) {
            root.appendChild(chip);
            root.appendChild(document.createTextNode(" "));
            placeCaretAtEnd(root);
            fireChange();
            return;
          }
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const space = document.createTextNode(" ");
          range.insertNode(space);
          range.insertNode(chip);
          const after = document.createRange();
          after.setStartAfter(space);
          after.collapse(true);
          sel.removeAllRanges();
          sel.addRange(after);
          fireChange();
        },
        replaceTokenWithFileChip: (triggerChar, file) => {
          const root = editorRef.current;
          if (!root) return false;
          const chip = buildFileChip(file);
          if (replaceTokenAtCaret(root, triggerChar, { kind: "chip", chip })) {
            fireChange();
            return true;
          }
          // Caret left the editor (dropdown focus); caller should rewrite the query string instead.
          return false;
        },
        replaceTokenWithText: (triggerChar, replacement) => {
          const root = editorRef.current;
          if (!root) return false;
          const ok = replaceTokenAtCaret(root, triggerChar, { kind: "text", value: replacement });
          if (ok) fireChange();
          return ok;
        },
      }),
      [fireChange],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (!submitDisabled) onSubmit();
        }
      },
      [onSubmit, submitDisabled],
    );

    const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();

      const isMarkdown = looksLikeMarkdownSource(text);
      const fragment = isMarkdown
        ? buildMarkdownFragment(text)
        : document.createDocumentFragment();
      if (!isMarkdown) {
        fragment.appendChild(document.createTextNode(text));
      }
      const lastInsertedNode = fragment.lastChild;
      if (!lastInsertedNode) return;

      range.insertNode(fragment);
      const after = document.createRange();
      after.setStartAfter(lastInsertedNode);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      fireChange();
    }, [fireChange]);

    return (
      <div className="relative">
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label="Workspace prompt input"
          contentEditable
          suppressContentEditableWarning
          onInput={fireChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="rounded-2xl w-full pl-5 pr-24 pt-4 pb-1 text-sm outline-none whitespace-pre-wrap wrap-break-word [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0
            min-h-12 max-h-80 overflow-y-auto noscrollbar
            dark:text-primary-300 text-primary-700"
        />
        {isEmpty && placeholder && (
          <Text
            as="div"
            tone="subtle"
            className="pointer-events-none absolute left-5 top-4"
          >
            {placeholder}
          </Text>
        )}
        {showFocusHint && (
          <Text
            as="kbd"
            size="xxs"
            tone="muted"
            className="absolute cursor-default right-3 top-3 px-1.5 py-0.5 font-sans"
          >
            ⌘ P to focus
          </Text>
        )}
      </div>
    );
  },
);

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}
