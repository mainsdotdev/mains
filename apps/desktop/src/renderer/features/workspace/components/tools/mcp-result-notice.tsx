import { useState } from "react";
import { Button, Text } from "@/components/ui";
import {
  mcpOutputSegments,
  mcpStructuredContentOmitted,
} from "../../lib/mcp-output";

export function McpResultNotice({ output }: { output: unknown }) {
  if (!mcpStructuredContentOmitted(output)) return null;
  return (
    <Text
      as="div"
      role="status"
      size="xs"
      tone="muted"
      className="my-2 rounded-md bg-primary-50 p-2 dark:bg-primary/5"
    >
      Some result data was omitted because the response was too large. Ask for
      fewer results or a narrower search.
    </Text>
  );
}

export function McpResultText({ body }: { body: string }) {
  const [full, setFull] = useState(false);
  const previewChars = 4_000;
  return (
    <>
      <Text
        as="pre"
        size="xs"
        tone="contrast"
        className="noscrollbar max-h-64 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-md bg-primary-50 p-2 font-mono dark:bg-primary/5"
      >
        <code>
          {full || body.length <= previewChars
            ? body
            : `${body.slice(0, previewChars)}\n… (${body.length - previewChars} more characters)`}
        </code>
      </Text>
      {!full && body.length > previewChars && (
        <Button variant="ghost" onClick={() => setFull(true)}>
          Show available text
        </Button>
      )}
    </>
  );
}

/** A widget cannot bootstrap from omitted data; retain its readable result. */
export function McpAppResultFallback({
  output,
  title,
  isPage = false,
}: {
  output: unknown;
  title: string;
  isPage?: boolean;
}) {
  const segments = mcpOutputSegments(output);
  return (
    <div
      className={isPage ? "h-full overflow-y-auto p-4" : "mt-2 rounded-lg p-3"}
    >
      <Text as="div" size="s" weight="medium">
        {title}
      </Text>
      <McpResultNotice output={output} />
      {segments.length > 0 && <McpResultText body={segments.join("\n\n")} />}
    </div>
  );
}
