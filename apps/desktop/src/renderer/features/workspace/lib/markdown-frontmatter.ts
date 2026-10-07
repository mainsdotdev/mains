import { dump, JSON_SCHEMA, load } from "js-yaml";

interface MetadataEntry {
  key: string;
  value: string;
}

export interface MarkdownDocumentContent {
  body: string;
  frontmatter: { source: string; entries: MetadataEntry[] | null } | null;
}

/** Only the leading, closed YAML block is metadata. The Markdown body stays
 * byte-for-byte intact, including ordinary horizontal rules and code fences. */
export function splitMarkdownFrontmatter(content: string): MarkdownDocumentContent {
  const match = content.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m);
  if (!match || match.index !== 0) return { body: content, frontmatter: null };

  const body = content.slice(match[0].length);
  const source = match[1].trimEnd();
  if (!source.trim()) return { body, frontmatter: null };
  try {
    const metadata = load(source, { schema: JSON_SCHEMA });
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return { body, frontmatter: { source, entries: null } };
    }
    const entries = Object.entries(metadata).map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value
        : value === null || typeof value !== "object" ? String(value)
        : dump(value, { schema: JSON_SCHEMA, lineWidth: -1 }).trimEnd(),
    }));
    return { body, frontmatter: { source, entries } };
  } catch {
    // A malformed YAML header is still useful content. Display its source as
    // text instead of letting its closing delimiter become a Setext heading.
    return { body, frontmatter: { source, entries: null } };
  }
}
