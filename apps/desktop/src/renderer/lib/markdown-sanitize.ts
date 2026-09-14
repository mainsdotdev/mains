import { defaultSchema } from "rehype-sanitize";

/**
 * Sanitize schema for rendering UNTRUSTED synced content (issue / note / signal
 * bodies pulled from GitHub, Linear, Jira, etc.) that may contain raw HTML.
 *
 * Built on rehype-sanitize's `defaultSchema`, which already:
 *  - strips `<script>`, `<style>`, and all `on*` event-handler attributes, and
 *  - restricts `href`/`src`/`cite` to safe protocols (no `javascript:` etc.).
 *
 * We extend it only with presentational, non-executable GitHub-flavored tags
 * and attributes so synced bodies still render faithfully (collapsible
 * `<details>`, super/subscript, sized images, table alignment). We deliberately
 * do NOT allow `style` or event handlers.
 *
 * Used together with `rehype-raw` — raw HTML is parsed first, then sanitized:
 *   rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
 */
export const markdownSanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "details",
    "summary",
    "sub",
    "sup",
    "kbd",
    "mark",
    "abbr",
    "samp",
    "figure",
    "figcaption",
  ],
  attributes: {
    ...defaultSchema.attributes,
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "width",
      "height",
      "loading",
      "align",
    ],
    th: [...(defaultSchema.attributes?.th ?? []), "align"],
    td: [...(defaultSchema.attributes?.td ?? []), "align"],
  },
};
