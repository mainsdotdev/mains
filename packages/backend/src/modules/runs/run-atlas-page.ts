import type { ModeId } from "@mains/contracts/modes";
import { atlasService } from "../atlas";

/** Resolve trusted Page metadata, keeping app instructions out of user messages. */
export function resolveAtlasPageContext(
  accountId: string,
  mode: ModeId,
  requestedId?: string,
  storedId?: unknown,
): { id: string; instructions: string } | null {
  if (requestedId === undefined && storedId === undefined) return null;
  if (
    requestedId !== undefined &&
    (typeof requestedId !== "string" || !requestedId.trim())
  )
    throw new Error("Invalid Atlas page");
  if (
    storedId !== undefined &&
    (typeof storedId !== "string" || !storedId.trim())
  )
    throw new Error("Invalid Atlas page");
  if (requestedId && storedId && requestedId !== storedId)
    throw new Error("Conversation belongs to another Atlas page");
  if (mode !== "work") throw new Error("Atlas page chats require Work mode");
  const id = (requestedId ?? storedId) as string;
  const page = atlasService.get({ accountId, id });
  if (!page || page.kind !== "page" || page.trashedAt)
    throw new Error("Page unavailable");
  return {
    id,
    instructions: `# Atlas page context

The user is working on Atlas page ${JSON.stringify(page.title)} (pageId: ${page.id}, current version: ${page.version}).
Use AtlasReadPage before editing. Apply changes with AtlasUpdatePage using the version returned by the read. Preserve the user's existing blocks, file references and formatting. If the version changed, read again and reconcile before saving. The page is stored in Atlas; do not write a separate Markdown file as the result.`,
  };
}
