import { createContext, useContext } from "react";

import { outputReferenceName } from "@/lib/output-reference";

/** Decides which local file references in a transcript are drawn as links. */
export type FileLinkFilter = (filePath: string) => boolean;

// Outside a conversation (an output's own Markdown preview) any previewable
// name may link; the output viewer explains what it cannot find.
const previewableName: FileLinkFilter = (filePath) => outputReferenceName(filePath.trim()) !== null;

const FileLinkContext = createContext<FileLinkFilter>(previewableName);

/** A run screen scopes links to what its own conversation can open. */
export const FileLinkProvider = FileLinkContext.Provider;

export function useFileLinkFilter(): FileLinkFilter {
  return useContext(FileLinkContext);
}
