import type { PrAuthor } from "@mains/contracts/pull-requests";
import { Text } from "@/components/ui";
import { proxiedImageSrc } from "@/lib/proxied-image-src";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-components";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
export function Avatar({ author }: { author: PrAuthor | null }) {
  const src = proxiedImageSrc(author?.avatarUrl);
  if (!src) {
    return (
      <span className="size-6 rounded-full bg-primary/30 dark:bg-primary/10 shrink-0" />
    );
  }
  return (
    <img
      src={src}
      alt={author?.login ?? ""}
      className="size-6 rounded-full shrink-0"
    />
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <Text
      as="div"
      size="s"
      tone="secondary"
      className="prose prose-sm dark:prose-invert max-w-none wrap-break-word"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
        components={markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </Text>
  );
}

