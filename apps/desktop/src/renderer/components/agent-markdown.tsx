import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import "katex/dist/katex.min.css";

import { Text } from "@/components/ui";
import { normalizeMathMarkdown, remarkStreamingMath } from "@/lib/math-markdown";
import { remarkStreamingLinks } from "@/lib/streaming-links";
import { rehypeStreamingText } from "@/lib/streaming-text";
import { markdownFileUrlTransform } from "@/lib/file-path";

import {
  agentMarkdownComponents,
  MarkdownCodeBlock,
  MarkdownImagePreviewContext,
  type MarkdownImagePreview,
} from "./markdown-components";
import { MermaidDiagram } from "./mermaid-diagram";

const settledMarkdownComponents: Components = {
  ...agentMarkdownComponents,
  pre: ({ node, children }) => {
    const fallback = <MarkdownCodeBlock>{children}</MarkdownCodeBlock>;
    const code = node?.children[0];
    if (code?.type !== "element" || code.tagName !== "code") return fallback;
    const { className } = code.properties;
    if (!Array.isArray(className) || !className.includes("language-mermaid")) return fallback;
    const source = code.children[0];
    return source?.type === "text" && source.value.trim()
      ? <MermaidDiagram source={source.value} fallback={fallback} />
      : fallback;
  },
};

/** The assistant renderer shared by settled and streaming report artifacts. */
export function AgentMarkdown({
  children,
  className,
  isStreaming = false,
  onImagePreview,
}: {
  children: string;
  className?: string;
  isStreaming?: boolean;
  onImagePreview?: (image: MarkdownImagePreview) => void;
}): ReactNode {
  return (
    // KaTeX display nodes are direct Markdown children, unlike paragraphs and
    // list items that already route through Text. Own the base tone here so
    // those generated spans inherit the correct light/dark foreground.
    <Text as="div" size="sm" className={className}>
      <MarkdownImagePreviewContext.Provider value={onImagePreview}>
        <ReactMarkdown
          urlTransform={markdownFileUrlTransform}
          components={isStreaming ? agentMarkdownComponents : settledMarkdownComponents}
          remarkPlugins={[
            remarkGfm,
            remarkMath,
            ...(isStreaming ? [remarkStreamingLinks, remarkStreamingMath] : []),
          ]}
          rehypePlugins={[
            ...(isStreaming ? [rehypeStreamingText] : []),
            rehypeKatex,
          ]}
        >
          {normalizeMathMarkdown(children)}
        </ReactMarkdown>
      </MarkdownImagePreviewContext.Provider>
    </Text>
  );
}
