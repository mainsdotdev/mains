import { openGitOperations, shutdownGitOperations } from "../../runtime/git-operation-lifecycle";
import { openPrAttachmentStorage, prAttachmentStorage } from "./pr-attachment-storage";

export function openGitFlow(): void {
  openPrAttachmentStorage();
  openGitOperations();
}

/** Accepted Git commands retain their files and database until they finish.
 * Only then can the temporary-file owner fence and drain remaining uploads. */
export async function shutdownGitFlow(): Promise<void> {
  await shutdownGitOperations();
  await prAttachmentStorage.dispose();
}
