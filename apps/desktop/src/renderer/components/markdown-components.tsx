import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Components } from "react-markdown";

import { Button, Checkbox, Text, toast } from "@/components/ui";
import { CODE_FONT_SIZE_CSS } from "@/lib/appearance-fonts";
import { faviconUrlForHref } from "@/lib/favicon-url";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import { FileIconComponent } from "@/components/ui/icons";
import { useOpenFileInEditor } from "@/features/workspace/hooks/use-open-file-in-editor";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { useOpenLink } from "@/hooks/use-open-link";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import { atlasPageIdFromHref } from "@/features/atlas/lib/page-link";

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

function decodeFileHrefPath(filePath: string): string {
  try {
    return decodeURIComponent(filePath);
  } catch {
    return filePath;
  }
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
 * File references render as an icon chip and open in the editor tab;
 * `#fragment` links stay inside the document. Chat surfaces may opt web URLs
 * into the in-app browser while other markdown keeps its existing behaviour.
 */
export function MarkdownLink({
  href,
  children,
  showFavicon = false,
  openWebLinksInApp = false,
}: {
  href?: string;
  children?: ReactNode;
  showFavicon?: boolean;
  openWebLinksInApp?: boolean;
}) {
  const openFileInEditor = useOpenFileInEditor();
  const openLink = useOpenLink();
  const { openHtmlFile } = useBrowserPanel();
  const isPageLink = !!href && !!atlasPageIdFromHref(href, window.location.href);

  // A fragment names a node in this very document — GFM footnote references
  // and their back-links are the common case. Handing it to the shell was a
  // silent no-op (main parses the URL and drops what has no protocol), which
  // left every footnote link dead.
  if (!isPageLink && href?.startsWith("#")) {
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
        className="document-link inline whitespace-normal wrap-break-word text-left"
      >
        {children}
      </a>
    );
  }

  const target = href ? splitFileHref(href) : null;
  if (!isPageLink && href && target && isFileHref(target.path)) {
    const basename = target.path.split("/").pop() ?? target.path;
    const dotIdx = basename.lastIndexOf(".");
    const extension =
      dotIdx > 0 && dotIdx < basename.length - 1
        ? basename.slice(dotIdx + 1)
        : undefined;
    const isHtml = extension?.toLowerCase() === "html" || extension?.toLowerCase() === "htm";
    return (
      <Button
        onClick={() => {
          const filePath = decodeFileHrefPath(target.path);
          if (isHtml && filePath.startsWith("/")) {
            void openHtmlFile(filePath).catch((error) => {
              toast.error(error instanceof Error ? error.message : "Failed to open HTML preview");
            });
          } else {
            openFileInEditor(filePath);
          }
        }}
        title={href}
        className="inline-flex align-middle items-center gap-1 mb-0.5 h-6 mx-0.5 rounded-lg text-s font-medium leading-none select-none  cursor-pointer text-accent hover:decoration-dotted hover:underline transition-colors"
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
          if (isPageLink || openWebLinksInApp) {
            void openLink(href);
          } else {
            void window.api.shell.openExternal(href);
          }
        }
      }}
      className="document-link inline whitespace-normal wrap-break-word text-left"
    >
      {showFavicon && !isPageLink && <LinkFavicon key={href} href={href} />}
      {children}
    </a>
  );
}

// Kept as part of this module's public surface for existing markdown callers.
export { faviconUrlForHref };

function LinkFavicon({ href }: { href: string | undefined }) {
  const faviconUrl = faviconUrlForHref(href);
  const [failed, setFailed] = useState(false);

  if (!faviconUrl || failed) return null;

  return (
    <img
      src={proxiedImageSrc(faviconUrl) ?? faviconUrl}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="mr-1 inline-block size-3.5 rounded-[3px] bg-primary/5 object-contain align-[-0.125em] ring-1 ring-black/5 dark:ring-white/10"
      style={{ marginTop: 0, marginBottom: 0 }}
    />
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

export type MarkdownImagePreview = { name: string; dataUrl: string };
export const MarkdownImagePreviewContext = createContext<((image: MarkdownImagePreview) => void) | undefined>(undefined);

/**
 * Markdown `img` with consent-gated remote loading.
 *
 * Markdown reaching this renderer is largely untrusted — agent/subagent
 * reports and external service bodies (issues, signals) alike — and an
 * auto-fetched remote image is a data-exfiltration beacon: a prompt-injected
 * agent can embed secrets in the URL's query string, and the request fires
 * the moment the view renders (through the proxy or not — the request itself
 * is the leak). Remote images therefore render as a click-to-load
 * placeholder; local paths are decoded and served through the signed image
 * protocol, while data: and app capture sources load directly. There is no
 * fallback to the raw URL on proxy error — that would reopen the channel.
 */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const onPreview = useContext(MarkdownImagePreviewContext);
  const [loadApproved, setLoadApproved] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const remote = isRemoteImageSrc(src);
  const localPath = src?.startsWith("/") && !src.startsWith("//") &&
    !src.startsWith("/__")
    ? decodeFileHrefPath(src)
    : undefined;
  const localUrl = useLocalImageUrl(localPath);

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

  const imageSrc = localPath ? localUrl : proxiedImageSrc(src) ?? src;
  if (!imageSrc || failedSrc === src) return null;

  const image = (
    <img
      src={imageSrc}
      alt={alt || ""}
      onError={() => setFailedSrc(src ?? "")}
      className="document-image"
    />
  );
  if (!onPreview || !localPath) return image;
  const name = alt?.trim() || localPath.split("/").pop() || "image";
  return (
    <Button
      onClick={() => onPreview({ name, dataUrl: imageSrc })}
      aria-label={`Preview ${name}`}
      title={`Click to preview · ${name}`}
      className="block w-fit max-w-full cursor-zoom-in rounded-lg focus-visible:ring-2 focus-visible:ring-accent"
    >
      {image}
    </Button>
  );
}

/**
 * Inline code or a fenced block, told apart by {@link InCodeBlock} rather than
 * by props. A named component, not an inline arrow in the map below: it reads
 * context, and only a component may.
 */
function MarkdownCode({ children, colorSwatches = false }: { children?: ReactNode; colorSwatches?: boolean }) {
  const isInline = !useContext(InCodeBlock);
  if (isInline) {
    const hexColor = colorSwatches && typeof children === "string" && /^#[0-9a-f]{6}$/i.test(children)
      ? children
      : null;
    // `size="inherit"` yields to the `0.9em` below: inline code stays relative
    // to its sentence so it never towers over the prose around it.
    const code = (
      <Text
        as="code"
        size="inherit"
        className="document-inline-code rounded"
      >
        {children}
      </Text>
    );
    if (!hexColor) return code;
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
        {code}
        <span
          role="img"
          aria-label={`${hexColor} color swatch`}
          className="inline-block size-3.5 shrink-0 rounded-[3px] ring-1 ring-primary-400/50 dark:ring-primary-500/60"
          style={{ backgroundColor: hexColor }}
        />
      </span>
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
 * tone. Content presentation lives in document-content.css, also applied to
 * BlockNote's editable nodes by the Atlas adapter. Text keeps its semantic
 * elements and tones, while shared utilities own document sizing and layout.
 */
export const markdownComponents: Components = {
  h1: ({ children }) => (
    <Text as="h1" size="inherit" className="document-h1">
      {children}
    </Text>
  ),
  h2: ({ children }) => (
    <Text as="h2" size="inherit" className="document-h2">
      {children}
    </Text>
  ),
  h3: ({ children }) => (
    <Text as="h3" size="inherit" className="document-h3">
      {children}
    </Text>
  ),
  h4: ({ children }) => (
    <Text as="h4" size="inherit" className="document-h4">
      {children}
    </Text>
  ),
  p: ({ children }) => (
    <Text as="p" size="inherit" className="document-paragraph">
      {children}
    </Text>
  ),
  ul: ({ children }) => (
    <Text as="ul" className="document-list list-disc">
      {children}
    </Text>
  ),
  ol: ({ children }) => (
    <Text
      as="ol"
      className="document-list list-decimal"
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
        size="inherit"
        id={id}
        // Tighter than a paragraph on purpose: list items are usually one
        // short line, and prose leading spreads them into unrelated rows.
        className={`document-list-item ${
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
    <div className="document-table-frame overflow-x-auto">
      <table className="document-table">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="document-table-head">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="document-table-body">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="document-table-row">
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <Text
      as="th"
      size="inherit"
      weight="semibold"
      align="left"
      className="document-table-cell"
    >
      {children}
    </Text>
  ),
  td: ({ children }) => (
    <Text
      as="td"
      size="inherit"
      className="document-table-cell"
    >
      {children}
    </Text>
  ),
  code: MarkdownCode,
  // Owns the block's surface and its horizontal scroll — an ASCII diagram wider
  // than the column has to slide inside the box rather than out of it.
  pre: ({ children }) => (
    <InCodeBlock.Provider value={true}>
      <pre className="document-code-block overflow-x-auto">
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
      className="document-quote"
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
  hr: () => <hr className="document-divider" />,
  img: ({ src, alt }) => (
    <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} />
  ),
};

/** Agent-authored prose opts into origin-only favicons for external links. */
export const agentMarkdownComponents: Components = {
  ...markdownComponents,
  code: ({ children }) => <MarkdownCode colorSwatches>{children}</MarkdownCode>,
  // Assistant tables are reading surfaces. Row separators keep palette and
  // comparison tables scannable without the full document-style cell grid.
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="min-w-full border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-primary-300/50 dark:border-primary-700/50">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-primary-200/40 last:border-b-0 dark:border-primary-700/35">
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <Text as="th" weight="semibold" align="left" className="px-3 py-2.5 first:pl-0 last:pr-0 font-sans">
      {children}
    </Text>
  ),
  td: ({ children }) => (
    <Text as="td" className="px-3 py-2.5 first:pl-0 last:pr-0 font-sans">
      {children}
    </Text>
  ),
  a: ({ href, children }) => (
    <MarkdownLink href={href} showFavicon openWebLinksInApp>
      {children}
    </MarkdownLink>
  ),
};
