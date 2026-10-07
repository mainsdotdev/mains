import { describe, expect, it } from "vitest";
import { prAttachmentUrl } from "@mains/contracts/pr-attachments";
import { insertPrMedia, removePrMedia, stagePrMediaReferences } from "./pr-media-markdown";

const image = { id: "before", name: "before.png", type: "image/png" };
const video = { id: "video", name: "demo.mp4", type: "video/mp4" };
describe("PR media placement", () => {
  it("replaces a selected comparison placeholder and keeps multiple images in one cell", () => {
    const value = "| Before | After |\n| --- | --- |\n| <!-- before --> | <!-- after --> |";
    const start = value.indexOf("<!-- before -->");
    const result = insertPrMedia(value, { value, start, end: start + "<!-- before -->".length }, [image, { ...image, id: "second" }]);
    expect(result.value).toBe(value.replace("<!-- before -->", `![before.png](${prAttachmentUrl("before")}) <br> ![before.png](${prAttachmentUrl("second")})`));
    expect(result.value.split("\n")).toHaveLength(3);
    expect(result.start).toBe(result.end);
  });
  it("embeds video outside a table and links it inside a table", () => {
    const value = "| Before | After |\n| --- | --- |\n|  |  |";
    const at = value.lastIndexOf("  |");
    const result = insertPrMedia(value + "\n\n### Testing", { value: value + "\n\n### Testing", start: at, end: at }, [video]);
    expect(result.value).toContain(`[demo.mp4](${prAttachmentUrl("video")})`);
    expect(result.value).toContain(`\n\n![demo.mp4](${prAttachmentUrl("video")})\n\n### Testing`);
    expect(insertPrMedia("", { value: "", start: 0, end: 0 }, [video]).value).toBe(`![demo.mp4](${prAttachmentUrl("video")})`);
  });
  it("escapes filenames without changing table columns or creating HTML", () => {
    const result = insertPrMedia("", { value: "", start: 0, end: 0 }, [{ ...image, name: "a|[b]<img>\n.png" }]);
    expect(result.value).toBe(`![a&#124;\\[b\\]&lt;img&gt; .png](${prAttachmentUrl("before")})`);
  });
  it("replaces the whole template comment when the caret is inside its placeholder", () => {
    const value = "| <!-- Paste before image here --> | Keep |";
    const start = value.indexOf("before");
    expect(insertPrMedia(value, { value, start, end: start }, [image]).value).toBe(`| ![before.png](${prAttachmentUrl("before")}) | Keep |`);
  });
  it("appends if a saved selection belongs to an overwritten draft", () => {
    expect(insertPrMedia("New body", { value: "Old", start: 0, end: 3 }, [image]).value).toBe(`New body\n\n![before.png](${prAttachmentUrl("before")})`);
  });
  it("removes repeated image and video references without deleting adjacent cells", () => {
    const url = prAttachmentUrl("before");
    const body = `| ![a\\[b\\].png](${url}) | [Again](${url}) | Keep |`;
    expect(removePrMedia(body, "before")).toBe("|  |  | Keep |");
  });
  it("maps duplicate references to the same upload and rejects dangling draft identities", () => {
    const body = `| ![Before](${prAttachmentUrl("before")}) | ![After](${prAttachmentUrl("before")}) |`;
    expect(stagePrMediaReferences(body, ["before"], ["upload"])).toBe(body.split(prAttachmentUrl("before")).join(prAttachmentUrl("upload")));
    expect(() => stagePrMediaReferences(body, [], [])).toThrow("missing");
  });
});
