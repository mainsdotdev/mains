import { Stack, useLocalSearchParams } from "expo-router";

import { MarkdownDocument } from "@/features/runs";

function titleFromPath(filePath: string): string {
  const withoutLocator = filePath
    .replace(/#L\d+(?:-\d+)?$/, "")
    .replace(/:\d+(?::\d+)?$/, "");
  const fileName = withoutLocator.split("/").pop();
  if (!fileName) return "Document";
  try {
    return readableDocumentTitle(decodeURIComponent(fileName)) || "Document";
  } catch {
    return readableDocumentTitle(fileName) || "Document";
  }
}

function readableDocumentTitle(fileName: string): string {
  return fileName
    .replace(/\.(?:md|markdown)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Route-only composition; document loading and rendering live in features/runs. */
export default function DocumentScreen() {
  const params = useLocalSearchParams<{ runId?: string; filePath?: string }>();
  const runId = typeof params.runId === "string" ? params.runId : "";
  const filePath = typeof params.filePath === "string" ? params.filePath : "";

  return (
    <>
      <Stack.Screen options={{ title: titleFromPath(filePath) }} />
      <MarkdownDocument key={`${runId}:${filePath}`} runId={runId} filePath={filePath} />
    </>
  );
}
