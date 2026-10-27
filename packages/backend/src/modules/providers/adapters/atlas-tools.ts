import type { MainsToolContext } from "./mains-tools.core";
import { atlasPageHref, type AtlasPage } from "@mains/contracts/atlas";
import { ATLAS_COVER_PRESETS } from "@mains/contracts/atlas-covers";
import { AtlasCreatePageSchema, AtlasListCoversSchema, AtlasReadPageSchema, AtlasUpdatePageSchema } from "./mains-tools.schemas";

async function context(ctx: MainsToolContext, write: boolean) {
  if (!ctx.runId) throw new Error("Atlas tools require an active conversation");
  const { runsService } = await import("../../runs");
  const run = await runsService.getRunById(ctx.runId);
  if (!run) throw new Error("Atlas conversation no longer exists");
  // Enforce here as well as in tool exposure: Chat must remain read-only.
  if (write && run.mode !== "work") throw new Error("Atlas Pages can only be changed in Work mode");
  const { atlasService } = await import("../../atlas");
  return { run, atlasService };
}
const result = (page: AtlasPage) => ({ content: [{ type: "text" as const,
  text: JSON.stringify({ ...page, pageHref: atlasPageHref(page.item.id) }) }] });
function content(input: { blocksJson?: string; markdown?: string }) {
  if (input.blocksJson === undefined && input.markdown === undefined) throw new Error("Supply blocksJson or markdown");
  return input.blocksJson !== undefined ? { blocks: JSON.parse(input.blocksJson) as unknown[], markdown: input.markdown }
    : { markdown: input.markdown };
}
interface Presentation { icon?: string | null; coverPreset?: string | null }
/**
 * Icon and cover are Page presentation: they are stored apart from content, so changing
 * them creates no revision. Agents pass a bare emoji; Atlas stores it as `emoji:<emoji>`.
 * The Atlas service validates and commits presentation together with content.
 */
function presentation({ icon, coverPreset }: Presentation) {
  const stored = icon === undefined || icon === null || icon.startsWith("emoji:") ? icon : `emoji:${icon}`;
  return { metadata: stored === undefined ? undefined : { icon: stored }, coverPreset };
}
export async function handleAtlasListCovers(input: unknown, ctx: MainsToolContext) {
  AtlasListCoversSchema.parse(input);
  await context(ctx, true);
  const lines = ATLAS_COVER_PRESETS.map((cover) => `${cover.id}: ${cover.description}`);
  return { content: [{ type: "text" as const,
    text: `Pass one id as coverPreset to AtlasCreatePage or AtlasUpdatePage.\n${lines.join("\n")}` }] };
}
export async function handleAtlasReadPage(input: unknown, ctx: MainsToolContext) {
  const args = AtlasReadPageSchema.parse(input);
  const { run, atlasService } = await context(ctx, false);
  const page = atlasService.getPage({ accountId: run.accountId, id: args.pageId });
  if (!page) throw new Error("Page not found");
  return result(page);
}
export async function handleAtlasCreatePage(input: unknown, ctx: MainsToolContext) {
  const args = AtlasCreatePageSchema.parse(input);
  const { run, atlasService } = await context(ctx, true);
  return result(await atlasService.createPage({ accountId: run.accountId, title: args.title,
    collectionId: run.collectionId, ...content(args), ...presentation(args) }, "agent", run.id));
}
export async function handleAtlasUpdatePage(input: unknown, ctx: MainsToolContext) {
  const args = AtlasUpdatePageSchema.parse(input);
  const { run, atlasService } = await context(ctx, true);
  const current = atlasService.getPage({ accountId: run.accountId, id: args.pageId });
  if (!current) throw new Error("Page not found");
  const edit = presentation(args);
  const changesContent = args.blocksJson !== undefined || args.markdown !== undefined;
  const changesPresentation = args.icon !== undefined || args.coverPreset !== undefined;
  if (!changesContent && args.title !== undefined) throw new Error("A new title needs blocksJson or markdown");
  if (!changesContent && !changesPresentation) throw new Error("Supply blocksJson, markdown, icon or coverPreset");
  // Presentation edits never create a revision, so only content changes use the version check.
  if (changesContent) return result(await atlasService.savePage({ accountId: run.accountId, id: args.pageId,
    expectedVersion: args.expectedVersion, title: args.title ?? current.item.title, ...content(args), ...edit }, "agent", run.id));
  await atlasService.update({ accountId: run.accountId, id: args.pageId, ...edit });
  return result(atlasService.getPage({ accountId: run.accountId, id: args.pageId })!);
}
