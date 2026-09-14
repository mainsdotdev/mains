import { lazy, Suspense } from "react";
import { Text } from "@/components/ui";
import { useAppSelector } from "@/lib/redux/hooks";

const CodeViewer = lazy(() =>
  import("./code-viewer").then((m) => ({ default: m.CodeViewer })),
);
const DiffViewer = lazy(() =>
  import("./diff-viewer").then((m) => ({ default: m.DiffViewer })),
);

interface EditorContentProps {
  className?: string;
}

export function EditorContent({ className = "" }: EditorContentProps) {
  const activeWorkspaceId = useAppSelector((state) => state.workspace.activeWorkspaceId);
  const selectedFile = useAppSelector((state) => state.workspace.selectedFile);
  const selectedFileContent = useAppSelector((state) => state.workspace.selectedFileContent);
  const isLoadingFileContent = useAppSelector((state) => state.workspace.isLoadingFileContent);
  const fileContentError = useAppSelector((state) => state.workspace.fileContentError);

  // Format file size for display
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Empty state - no file selected
  if (!selectedFile) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>

      </div>
    );
  }

  // Loading state
  if (isLoadingFileContent) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <Text as="div" size="inherit" tone="subtle" className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <Text as="span" size="xs" tone="inherit">Loading file...</Text>
        </Text>
      </div>
    );
  }

  // Error state
  if (fileContentError) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <Text as="div" size="inherit" tone="danger" align="center" className="flex flex-col items-center gap-2 px-4">
          <svg
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <Text as="span" size="xs" tone="inherit">{fileContentError}</Text>
        </Text>
      </div>
    );
  }

  // No content loaded yet
  if (!selectedFileContent) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <Text as="div" size="inherit" tone="subtle" className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <Text as="span" size="xs" tone="inherit">Loading...</Text>
        </Text>
      </div>
    );
  }

  // Binary file
  if (selectedFileContent.isBinary) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <Text as="div" size="inherit" tone="subtle" align="center" className="flex flex-col items-center gap-2 px-4">
          <svg
            className="w-8 h-8 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <Text as="span" size="sm" tone="inherit" weight="medium">{selectedFile.name}</Text>
          <Text as="span" size="xs" tone="inherit">Binary file ({formatFileSize(selectedFileContent.size)})</Text>
          <Text as="span" size="xs" tone="inherit" className="opacity-60">Preview not available for binary files</Text>
        </Text>
      </div>
    );
  }

  if (selectedFile.extension === "diff") {
    return (
      <div className={`flex flex-col h-full noscrollbar ${className}`}>
        <div className="flex-1 min-h-0 my-2 overflow-hidden noscrollbar">
          <Suspense fallback={null}>
            <DiffViewer
              diffText={selectedFileContent.content}
              className="h-full noscrollbar"
              workspaceId={activeWorkspaceId ?? undefined}
              filePath={selectedFile.fullPath}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  // Render code viewer
  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex-1 min-h-0 py-2 overflow-hidden noscrollbar">
        <Suspense fallback={null}>
          <CodeViewer
            key={selectedFile.fullPath}
            content={selectedFileContent.content}
            filename={selectedFile.name}
            filePath={selectedFile.fullPath}
            mtimeMs={selectedFileContent.mtimeMs}
            workspaceId={activeWorkspaceId ?? undefined}
            className="h-full"
          />
        </Suspense>
      </div>
    </div>
  );
}
