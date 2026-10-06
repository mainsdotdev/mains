import type { MainsToolContext } from "./mains-tools.core";
import { AtlasCreatePageSchema, AtlasReadPageSchema, AtlasUpdatePageSchema } from "./mains-tools.schemas";

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
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
function content(input: { blocksJson?: string; markdown?: string }) {
  if (input.blocksJson === undefined && input.markdown === undefined) throw new Error("Supply blocksJson or markdown");
  return input.blocksJson !== undefined ? { blocks: JSON.parse(input.blocksJson) as unknown[], markdown: input.markdown }
    : { markdown: input.markdown };
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
    collectionId: run.collectionId, ...content(args) }, "agent", run.id));
}
export async function handleAtlasUpdatePage(input: unknown, ctx: MainsToolContext) {
  const args = AtlasUpdatePageSchema.parse(input);
  const { run, atlasService } = await context(ctx, true);
  const current = atlasService.getPage({ accountId: run.accountId, id: args.pageId });
  if (!current) throw new Error("Page not found");
  return result(await atlasService.savePage({ accountId: run.accountId, id: args.pageId,
    expectedVersion: args.expectedVersion, title: args.title ?? current.item.title, ...content(args) }, "agent", run.id));
}
