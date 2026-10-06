// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { PR_ATTACHMENT_CHUNK_BYTES } from "@mains/contracts/pr-attachments";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { withPrAttachments } from "./pr-attachment-upload";

const transport = (invoke = vi.fn().mockResolvedValue({ success: true, data: { uploadId: "upload-1" } })) => ({
  kind: "test", invoke, subscribe: () => () => undefined, status: () => "connected", onStatusChange: () => () => undefined,
}) as Transport;
afterEach(resetTransport);

describe("PR media staging", () => {
  it("sends bounded chunks, then creates once and discards staged files", async () => {
    const backend = transport(); setTransport(backend);
    const file = new File([new Uint8Array(PR_ATTACHMENT_CHUNK_BYTES + 3)], "demo.mp4");
    const create = vi.fn().mockResolvedValue({ url: "pr" });
    await withPrAttachments("ws", [file], create, vi.fn(), new AbortController().signal);
    const calls = vi.mocked(backend.invoke).mock.calls;
    expect(calls.map(([channel]) => channel)).toEqual([CHANNELS.gitFlow.stagePrAttachment, CHANNELS.gitFlow.stagePrAttachment, CHANNELS.gitFlow.discardPrAttachments]);
    expect((calls[0][1]?.[0] as { data: string }).data.length).toBeLessThanOrEqual(Math.ceil(PR_ATTACHMENT_CHUNK_BYTES / 3) * 4);
    expect(calls[1][1]?.[0]).toMatchObject({ uploadId: "upload-1", offset: PR_ATTACHMENT_CHUNK_BYTES });
    expect(create).toHaveBeenCalledExactlyOnceWith(["upload-1"]);
  });
  it("cleans up after a rejected create and preserves its error", async () => {
    const backend = transport(); setTransport(backend);
    await expect(withPrAttachments("ws", [new File(["abc"], "demo.png")], async () => { throw new Error("denied"); }, vi.fn(), new AbortController().signal)).rejects.toThrow("denied");
    expect(backend.invoke).toHaveBeenLastCalledWith(CHANNELS.gitFlow.discardPrAttachments, ["ws", ["upload-1"]]);
  });
  it("never creates on a backend selected midway through staging", async () => {
    const other = transport();
    const first = transport(vi.fn().mockImplementation(async () => { setTransport(other); return { success: true, data: { uploadId: "upload-1" } }; }));
    setTransport(first);
    const create = vi.fn();
    await expect(withPrAttachments("ws", [new File(["abc"], "demo.png")], create, vi.fn(), new AbortController().signal)).rejects.toThrow("backend changed");
    expect(create).not.toHaveBeenCalled();
    expect(other.invoke).not.toHaveBeenCalled();
    expect(first.invoke).toHaveBeenLastCalledWith(CHANNELS.gitFlow.discardPrAttachments, ["ws", ["upload-1"]]);
  });
});
