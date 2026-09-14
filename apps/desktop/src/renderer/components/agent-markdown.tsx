import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import "katex/dist/katex.min.css";

import { Text } from "@/components/ui";
import { normalizeMathMarkdown } from "@/lib/math-markdown";

import { markdownComponents } from "./markdown-components";

/** The assistant renderer shared by settled and streaming report artifacts. */
export function AgentMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}): ReactNode {
  return (
    // KaTeX display nodes are direct Markdown children, unlike paragraphs and
    // list items that already route through Text. Own the base tone here so
    // those generated spans inherit the correct light/dark foreground.
    <Text as="div" size="sm" className={className}>
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalizeMathMarkdown(children)}
      </ReactMarkdown>
    </Text>
  );
}
