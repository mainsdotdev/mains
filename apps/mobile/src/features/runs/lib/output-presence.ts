import type { RunOutputsPage } from "@mains/contracts/run-outputs";

/** Missing files can leave empty metadata pages before a later available output. */
export async function hasRunOutputs(read: (offset: number) => Promise<RunOutputsPage>, active = () => true): Promise<boolean> {
  let offset = 0;
  while (active()) {
    const page = await read(offset);
    if (!active()) return false;
    if (page.items.length > 0) return true;
    if (page.nextOffset === null) return false;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error("Invalid output page");
    offset = page.nextOffset;
  }
  return false;
}
