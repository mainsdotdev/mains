import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Text } from "@/components/ui";
import { appApi } from "@/lib/transport";
import { fetchLocalDocument, localDocumentUrlRevision, subscribeLocalDocumentUrls } from "@/lib/local-document-url";
import { TEXT_PREVIEW_MAX_BYTES } from "@mains/contracts/output-files";
import { markdownComponents } from "@/components/markdown-components";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import { isAbsoluteFilePath, markdownFileUrlTransform, resolveDocumentImagePath } from "@/lib/file-path";
import { splitMarkdownFrontmatter } from "../../lib/markdown-frontmatter";
import { createDocumentTask, documentIdentity } from "../../lib/document-lifecycle";

/** Resolve README image references against the file, then use the signed image renderer. */
function documentImageUrl(url: string, path: string): string {
  const safeUrl = markdownFileUrlTransform(url);
  if (!safeUrl) return safeUrl;
  try {
    // Normalize network URLs for the shared load gate.
    if (safeUrl.startsWith("//")) return new URL(`https:${safeUrl}`).href;
    if (/^https?:/i.test(safeUrl)) return new URL(safeUrl).href;
    const resolved = resolveDocumentImagePath(safeUrl, path);
    // The shared image component decodes its href once. Keep literal percent
    // sequences in native filenames encoded until that boundary.
    return isAbsoluteFilePath(resolved)
      ? encodeURI(resolved).replace(/#/g, "%23").replace(/\?/g, "%3F")
      : resolved;
  } catch {
    return "";
  }
}

// Local documents can name a Windows drive or a file URL. The URL transform
// still admits only absolute file paths; script/data schemes stay blocked.
const fileProtocols = ["file", ..."abcdefghijklmnopqrstuvwxyz"];
const documentSanitizeSchema = {
  ...markdownSanitizeSchema,
  protocols: {
    ...markdownSanitizeSchema.protocols,
    href: [...(markdownSanitizeSchema.protocols?.href ?? []), ...fileProtocols],
    src: [...(markdownSanitizeSchema.protocols?.src ?? []), ...fileProtocols],
  },
};

/**
 * Markdown in the viewer panel: React all the way down, unlike the Office
 * formats. Those are foreign bytes that only their own libraries can lay out,
 * so they live behind a shadow root; markdown is already the language this app
 * renders everywhere else, and going through the shadow boundary would strip
 * the theme and the shared components off it for nothing.
 *
 * On-disk text comes through `fileExplorer.readFileText`, with the editor's
 * regular-file, size and binary guards. Unsent attachments use their local
 * blob URL with the same preview size limit and null-byte check.
 *
 * Source and transport revisions retire the previous read and immediately
 * hide its body, including when a preview tab keeps the same component.
 */
export function MarkdownDocument({ path, docType = "md" }: { path: string; docType?: "md" | "txt" }) {
  const revision = useSyncExternalStore(subscribeLocalDocumentUrls, localDocumentUrlRevision);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const identity = documentIdentity({ path, docType }, revision);
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  if (identity !== loadedIdentity) { setLoadedIdentity(identity); setContent(null); setError(null); }
  const document = useMemo(() => content === null ? null : splitMarkdownFrontmatter(content), [content]);

  useEffect(() => {
    const task = createDocumentTask();

    void (async () => {
      try {
        if (path.startsWith("blob:")) {
          const response = await fetchLocalDocument(path, { signal: task.signal });
          const blob = await response.blob();
          if (!task.current()) return;
          if (blob.size > TEXT_PREVIEW_MAX_BYTES) {
            task.fail(() => setError(`This text document exceeds the ${TEXT_PREVIEW_MAX_BYTES / (1024 * 1024)} MiB inline preview limit.`));
            return;
          }
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (!task.current()) return;
          if (bytes.subarray(0, 8192).includes(0)) {
            task.fail(() => setError("This file isn't text"));
            return;
          }
          task.ready(() => setContent(new TextDecoder().decode(bytes)));
          return;
        }
        const res = await appApi.fileExplorer.readFileText({ filePath: path });
        if (!task.current()) return;
        if (!res.success) {
          task.fail(() => setError(res.error ?? "Failed to read file"));
          return;
        }
        if (res.data.isBinary) {
          task.fail(() => setError("This file isn't text"));
          return;
        }
        task.ready(() => setContent(res.data.content));
      } catch {
        task.fail(() => setError("Failed to read file"));
      }
    })();

    return () => {
      task.close();
    };
  }, [path, docType, revision]);

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
    <Text as="div" size="sm" className="flex-1 overflow-auto overscroll-none px-7 py-5">
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
        rehypePlugins={docType === "md" ? [rehypeRaw, [rehypeSanitize, documentSanitizeSchema]] : []}
        components={markdownComponents}
        // A native picture source would bypass MarkdownImage's load action.
        disallowedElements={["source"]}
        urlTransform={(url, key) => key === "src" ? documentImageUrl(url, path) : markdownFileUrlTransform(url)}
      >
        {document.body}
      </ReactMarkdown>
    </Text>
  );
}
