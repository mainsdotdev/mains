import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Text } from "@/components/ui";
import { appApi } from "@/lib/transport";
import { markdownComponents } from "@/components/markdown-components";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import { splitMarkdownFrontmatter } from "../../lib/markdown-frontmatter";

/** Resolve README image references against the file, then use the signed image renderer. */
function documentImageUrl(url: string, path: string): string {
  const safeUrl = defaultUrlTransform(url);
  if (!safeUrl) return safeUrl;
  try {
    // Normalize network URLs for the shared load gate.
    if (safeUrl.startsWith("//")) return new URL(`https:${safeUrl}`).href;
    if (/^https?:/i.test(safeUrl)) return new URL(safeUrl).href;
    if (safeUrl.startsWith("/") || safeUrl.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(safeUrl) || !path.startsWith("/")) {
      return safeUrl;
    }
    const base = `file://${path.split("/").map(encodeURIComponent).join("/")}`;
    return new URL(safeUrl, base).pathname;
  } catch {
    return "";
  }
}

/**
 * Markdown in the viewer panel: React all the way down, unlike the Office
 * formats. Those are foreign bytes that only their own libraries can lay out,
 * so they live behind a shadow root; markdown is already the language this app
 * renders everywhere else, and going through the shadow boundary would strip
 * the theme and the shared components off it for nothing.
 *
 * Text comes through `fileExplorer.readFileText`, which keeps the regular-file,
 * size, and binary guards — the same seam the editor tab reads through.
 *
 * Keyed by path at the call site: a new document is a new component, so its
 * state starts empty and the panel never paints one file's body under
 * another's name.
 */
export function MarkdownDocument({ path, docType = "md" }: { path: string; docType?: "md" | "txt" }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const document = useMemo(() => content === null ? null : splitMarkdownFrontmatter(content), [content]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await appApi.fileExplorer.readFileText({ filePath: path });
        if (cancelled) return;
        if (!res.success) {
          setError(res.error ?? "Failed to read file");
          return;
        }
        if (res.data.isBinary) {
          setError("This file isn't text");
          return;
        }
        setContent(res.data.content);
      } catch {
        if (!cancelled) setError("Failed to read file");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) {
    return (
      <Text
        as="div"
        size="xs"
        tone="subtle"
        className="flex-1 flex items-center justify-center px-6 text-center"
      >
        {error}
      </Text>
    );
  }

  if (document === null) {
    return (
      <Text
        as="div"
        size="xs"
        tone="subtle"
        className="flex-1 flex items-center justify-center"
      >
        Loading…
      </Text>
    );
  }

  return (
    <Text as="div" size="sm" className="flex-1 overflow-auto px-7 py-5">
      {document.frontmatter && (
        <section aria-label="Metadata" className="@container/metadata mb-6 rounded-2xl  bg-primary-100/50 p-3 glass-surface dark:bg-primary-900/50">
          <Text as="h2" size="xs" tone="subtle" weight="medium" className="mb-3">Metadata</Text>
          {document.frontmatter.entries ? (
            <dl className="space-y-2">
              {document.frontmatter.entries.map(({ key, value }) => (
                <div key={key} className="grid gap-x-4 gap-y-1 @[360px]/metadata:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]">
                  <Text as="dt" size="s" tone="subtle" className="min-w-0 wrap-anywhere font-mono">{key}</Text>
                  <Text as="dd" size="s" className="min-w-0 whitespace-pre-wrap wrap-anywhere font-mono">{value}</Text>
                </div>
              ))}
            </dl>
          ) : (
            <Text as="pre" size="s" className="whitespace-pre-wrap wrap-anywhere font-mono">{document.frontmatter.source}</Text>
          )}
        </section>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={docType === "md" ? [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]] : []}
        components={markdownComponents}
        // A native picture source would bypass MarkdownImage's load action.
        disallowedElements={["source"]}
        urlTransform={(url, key) => key === "src" ? documentImageUrl(url, path) : defaultUrlTransform(url)}
      >
        {document.body}
      </ReactMarkdown>
    </Text>
  );
}
