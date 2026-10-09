import { describe, expect, it } from "vitest";
import { atlasPageIdFromHref } from "./page-link";

const appHref = "https://mains.example/app/index.html#/work/chat";

describe("Atlas Page references", () => {
  it.each([
    "/atlas/page-1",
    "/atlas/page-1?view=editor#heading",
    "#/atlas/page-1",
    "https://mains.example/app/index.html#/atlas/page-1",
    "https://mains.example/atlas/page-1",
    "http://localhost:5173/#/atlas/page-1",
    "http://127.0.0.1:5173/index.html#/atlas/page-1",
    "http://[::1]:5173/#/atlas/page-1",
    "/atlas/%70age-1",
  ])("resolves %s", (href) => {
    expect(atlasPageIdFromHref(href, appHref)).toBe("page-1");
  });

  it("recognizes the packaged app's own hash route", () => {
    const entry = "file:///Applications/Mains.app/Contents/Resources/index.html";
    expect(atlasPageIdFromHref(`${entry}#/atlas/page-1`, `${entry}#/work`)).toBe("page-1");
    expect(atlasPageIdFromHref("file:///tmp/report.html#/atlas/page-1", entry)).toBeNull();
  });

  it.each([
    "https://external.example/#/atlas/page-1",
    "https://external.example/atlas/page-1",
    "https://mains.example/docs#/atlas/page-1",
    "http://localhost:5173/docs#/atlas/page-1",
    "http://localhost.evil.example:5173/#/atlas/page-1",
    "/Users/example/report.pdf",
    "#footnote-1",
    "/atlas/images/new",
    "/atlas/",
    "/atlas/../settings",
    "/atlas/page%2Fother",
    "/atlas/page%5Cother",
    "/atlas/%invalid",
  ])("leaves non-Page or malformed reference %s alone", (href) => {
    expect(atlasPageIdFromHref(href, appHref)).toBeNull();
  });
});
