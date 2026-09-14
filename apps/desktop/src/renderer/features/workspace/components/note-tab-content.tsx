import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-components";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import { useGetReviewQuery } from "@/lib/redux/api";
import { Body, Heading2, Text } from "@/components/ui";

interface NoteTabContentProps {
  reviewId: string;
}


export function NoteTabContent({ reviewId }: NoteTabContentProps) {
  const { data: review, isLoading } = useGetReviewQuery(reviewId);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Text as="span" tone="subtle">Loading...</Text>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="h-full flex items-center justify-center">
        <Text as="span" tone="subtle">Review not found</Text>
      </div>
    );
  }

  const updatedAt = review.updatedAt
    ? new Date(typeof review.updatedAt === "number" ? review.updatedAt * 1000 : review.updatedAt)
    : null;

  return (
    <div className="h-full overflow-y-auto noscrollbar">
      <div className="max-w-210 mx-auto pt-12 pb-24 px-6 space-y-6">
        <div className="space-y-3">
          <Heading2>
            {review.title}
          </Heading2>

          <div className="flex items-center gap-3 flex-wrap">
            {/* <span
              className={`inline-flex capitalize items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.badgeClass}`}
            >
              <span className={`w-2 h-2 rounded-full ${config.dotClass}`} />
              {config.label}
            </span> */}
            {updatedAt && (
              <Text as="span" size="xs" tone="subtle">
                Created in {updatedAt.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </Text>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {review.summary ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
                components={markdownComponents}
              >
                {review.summary}
              </ReactMarkdown>
            </div>
          ) : (
            <Body>
              No summary provided.
            </Body>
          )}
        </div>
      </div>
    </div>
  );
}
