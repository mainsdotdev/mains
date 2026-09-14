import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Components } from "react-markdown";

import { Button, Checkbox, Text } from "@/components/ui";
import { CODE_FONT_SIZE_CSS } from "@/lib/appearance-fonts";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { FileIconComponent } from "@/components/ui/icons";
import { useOpenFileInEditor } from "@/features/workspace/hooks/use-open-file-in-editor";

/**
 * Split a trailing line locator off a file href: `path.ts:114`,
 * `path.ts:114:7`, or `path.ts#L114-120` all resolve to `path.ts`.
 */
function splitFileHref(href: string): { path: string; line?: number } {
  const hash = href.match(/^(.*?)#L(\d+)(?:-\d+)?$/);
  if (hash) return { path: hash[1], line: Number(hash[2]) };
  const colon = href.match(/^(.*?):(\d+)(?::\d+)?$/);
  if (colon) return { path: colon[1], line: Number(colon[2]) };
  return { path: href };
}

/**
 * Href with no URL scheme whose last segment looks like a file — an agent's
 * reference to a workspace file rather than a web link.
 */
function isFileHref(href: string): boolean {
  if (!href || href.startsWith("#") || href.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  const last = href.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]+$/.test(last) || href.includes("/");
}

/**
 * File references render as an icon chip and open in the editor tab; real
 * URLs open in the system browser; `#fragment` links stay inside the document.
 */
export function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const openFileInEditor = useOpenFileInEditor();

  // A fragment names a node in this very document — GFM footnote references
  // and their back-links are the common case. Handing it to the shell was a
  // silent no-op (main parses the URL and drops what has no protocol), which
  // left every footnote link dead.
  if (href?.startsWith("#")) {
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          const id = decodeURIComponent(href.slice(1));
          document
            .getElementById(id)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        title={href}
        className="inline whitespace-normal wrap-break-word text-left text-accent hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 "
      >
        {children}
      </a>
    );
  }

  const target = href ? splitFileHref(href) : null;
  if (href && target && isFileHref(target.path)) {
    const basename = target.path.split("/").pop() ?? target.path;
    const dotIdx = basename.lastIndexOf(".");
    const extension =
      dotIdx > 0 && dotIdx < basename.length - 1
        ? basename.slice(dotIdx + 1)
        : undefined;
    return (
      <Button
        onClick={() => openFileInEditor(target.path)}
        title={href}
        className="inline-flex align-middle items-center gap-1 px-1.5 mb-0.5 h-6 mx-0.5 rounded-lg text-xs font-medium leading-none select-none bg-primary-50 dark:bg-primary-300/10 text-primary-800 dark:text-primary-200 cursor-pointer hover:bg-primary-200/60 dark:hover:bg-primary-300/20 transition-colors"
      >
        <FileIconComponent
          extension={extension}
          fileName={basename}
          className="size-3.5 shrink-0"
        />
        <span className="leading-none truncate max-w-60">{children}</span>
      </Button>
    );
  }

  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href) {
          window.api.shell.openExternal(href);
        }
      }}
      className="inline whitespace-normal wrap-break-word text-left text-accent hover:underline cursor-pointer  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 "
    >
      {children}
    </a>
  );
}

/**
 * Whether the `code` being rendered sits inside a `pre`.
 *
 * The props cannot answer it: react-markdown hands `code` a `language-*` class
 * only when the fence names one, so a bare ``` block and an inline span look
 * identical from there — which is how fenced blocks with no language ended up
 * rendering as a row of inline pills spilling out of their box. The `pre`
 * renderer is the one place that knows, so it says so.
 */
const InCodeBlock = createContext(false);

/** Network URLs — the only sources whose mere loading has a side effect. */
export function isRemoteImageSrc(src: string | undefined | null): src is string {
  return !!src && (src.startsWith("https://") || src.startsWith("http://"));
}

/**
 * Markdown `img` with consent-gated remote loading.
 *
 * Markdown reaching this renderer is largely untrusted — agent/subagent
 * reports and external service bodies (issues, signals) alike — and an
 * auto-fetched remote image is a data-exfiltration beacon: a prompt-injected
 * agent can embed secrets in the URL's query string, and the request fires
 * the moment the view renders (through the proxy or not — the request itself
 * is the leak). Remote images therefore render as a click-to-load
 * placeholder; local sources (data:, app capture schemes, workspace paths)
 * have no network side effect and load directly. There is deliberately no
 * fallback to the raw URL on proxy error — that would reopen the channel.
 */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [loadApproved, setLoadApproved] = useState(false);
  const remote = isRemoteImageSrc(src);

  if (remote && !loadApproved) {
    let host = src;
    try {
      host = new URL(src).host;
    } catch {
      // Unparseable URL — show it verbatim so the user can judge it.
    }
    return (
      <Button
        onClick={() => setLoadApproved(true)}
        title={src}
        className="my-2 flex w-fit max-w-full items-center gap-2 rounded-lg border border-dashed border-primary-300 px-3 py-2 text-xs text-primary-500 transition-colors hover:border-primary-400 hover:text-primary-700 dark:border-primary-700 dark:hover:border-primary-500 dark:hover:text-primary-300"
      >
        <span className="truncate">
          {alt?.trim() ? `${alt.trim()} — ` : ""}remote image from {host}
        </span>
        <Text as="span" size="inherit" tone="inherit" weight="medium" className="shrink-0">
          Load
        </Text>
      </Button>
    );
  }

  return (
    <img
      src={proxiedImageSrc(src) ?? src}
      alt={alt || ""}
      className="max-w-full h-auto rounded-lg my-2 border border-primary-200 dark:border-primary-700"
    />
  );
}

/**
 * Inline code or a fenced block, told apart by {@link InCodeBlock} rather than
 * by props. A named component, not an inline arrow in the map below: it reads
 * context, and only a component may.
 */
function MarkdownCode({ children }: { children?: ReactNode }) {
  const isInline = !useContext(InCodeBlock);
  if (isInline) {
    // `size="inherit"` yields to the `0.9em` below: inline code stays relative
    // to its sentence so it never towers over the prose around it.
    return (
      <Text
        as="code"
        size="inherit"
        className="px-1 py-0.5 rounded text-[0.9em] bg-primary-200/40 dark:bg-primary/10"
      >
        {children}
      </Text>
    );
  }
  // Blocks carry the Code font-size setting instead, which is a pixel value
  // off the `--text-*` ramp — hence `size="inherit"` here too. The surface
  // belongs to the `pre` around it: two nested backgrounds drew a box inside
  // a box, and only the outer one could scroll.
  return (
    <Text
      as="code"
      size="inherit"
      className="block"
      style={{ fontSize: CODE_FONT_SIZE_CSS }}
    >
      {children}
    </Text>
  );
}

/**
 * Custom ReactMarkdown component overrides for consistent styling.
 *
 * Every prose node routes through {@link Text}, whose default tone is the prose
 * tone — so no entry below names a colour, and none of them can drift apart the
 * way `th` and `td` once had. `className` is left holding layout only: margins,
 * list decoration, table rules, and the `font-sans` that pulls prose out of a
 * monospace ancestor.
 */
export const  markdownComponents: Components = {
  h1: ({ children }) => (
    <Text as="h1" size="lg" weight="bold" className="mt-4 mb-2 font-sans">
      {children}
    </Text>
  ),
  h2: ({ children }) => (
    <Text as="h2" size="base" weight="semibold" className="mt-2 mb-1 font-sans">
      {children}
    </Text>
  ),
  h3: ({ children }) => (
    <Text as="h3" weight="semibold" className="mt-2 mb-1 font-sans">
      {children}
    </Text>
  ),
  h4: ({ children }) => (
    <Text as="h4" size="xs" weight="semibold" className="mt-1 mb-0.5 font-sans">
      {children}
    </Text>
  ),
  p: ({ children }) => (
    <Text as="p" className="leading-7 font-sans">
      {children}
    </Text>
  ),
  ul: ({ children }) => (
    <Text as="ul" className="list-disc list-outside pl-4 font-sans mb-2 space-y-0.5">
      {children}
    </Text>
  ),
  ol: ({ children }) => (
    <Text
      as="ol"
      className="list-decimal list-outside pl-4 font-sans mb-2 space-y-0.5"
    >
      {children}
    </Text>
  ),
  // `id` is forwarded because GFM footnotes land on the list item — without it
  // the reference above has nothing to scroll to.
  li: ({ children, className, id }) => {
    // GFM marks checkbox items; they carry their own box, so the bullet goes
    // and the row pulls back into the list's indent.
    const isTask = className?.includes("task-list-item");
    return (
      <Text
        as="li"
        id={id}
        // Tighter than a paragraph on purpose: list items are usually one
        // short line, and prose leading spreads them into unrelated rows.
        className={`font-sans leading-6 [&>p]:my-0 [&>p:not(:last-child)]:mb-1 ${
          isTask ? "list-none -ml-4 flex items-start gap-2" : ""
        }`}
      >
        {children}
      </Text>
    );
  },
  // The only `input` markdown can produce is GFM's task-list checkbox. It goes
  // through the app's own Checkbox so a plan looks like the rest of the UI
  // rather than an OS control, and stays disabled — the box reports what the
  // author wrote, it is not a control the reader owns.
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <Checkbox checked={!!checked} disabled className="mt-1 shrink-0" />
    ) : null,
  table: ({ children }) => (
    <div className="overflow-x-auto my-4 rounded-lg border border-primary-300 dark:border-primary-700">
      <table className="min-w-full border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-primary-50 dark:bg-primary/10">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="bg-primary dark:bg-primary/5">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="border-b border-primary-200 dark:border-primary-700 hover:bg-primary-200/20 dark:hover:bg-primary/5 transition-colors duration-150">
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <Text
      as="th"
      weight="semibold"
      align="left"
      className="px-4 py-3 font-sans border-r border-primary-200 dark:border-primary-700 last:border-r-0"
    >
      {children}
    </Text>
  ),
  td: ({ children }) => (
    <Text
      as="td"
      className="px-4 py-3 font-sans border-r border-primary-200 dark:border-primary-700 last:border-r-0"
    >
      {children}
    </Text>
  ),
  code: MarkdownCode,
  // Owns the block's surface and its horizontal scroll — an ASCII diagram wider
  // than the column has to slide inside the box rather than out of it.
  pre: ({ children }) => (
    <InCodeBlock.Provider value={true}>
      <pre className="my-2 p-4 rounded-xl overflow-x-auto bg-primary-50 dark:bg-primary/10">
        {children}
      </pre>
    </InCodeBlock.Provider>
  ),
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  // The three inline marks size themselves from the sentence they sit in.
  blockquote: ({ children }) => (
    <Text
      as="blockquote"
      size="inherit"
      tone="muted"
      className="border-l-4 border-primary-400 dark:border-primary-600 pl-4 py-1 my-2 italic"
    >
      {children}
    </Text>
  ),
  strong: ({ children }) => (
    <Text as="strong" size="inherit" weight="semibold">
      {children}
    </Text>
  ),
  em: ({ children }) => (
    <Text as="em" size="inherit" className="italic">
      {children}
    </Text>
  ),
  hr: () => <hr className="my-4 border-primary-300 dark:border-primary-700" />,
  img: ({ src, alt }) => (
    <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} />
  ),
};
