import { describe, expect, it } from "vitest";
import {
  BLANK_URL,
  classifyBrowserInput,
  isAllowedBrowserUrl,
  resolveBrowserInput,
} from "./browser-url";

describe("resolveBrowserInput", () => {
  it("keeps supported absolute URLs", () => {
    expect(resolveBrowserInput("https://example.com/docs?q=1")).toBe(
      "https://example.com/docs?q=1",
    );
    expect(resolveBrowserInput("about:blank")).toBe("about:blank");
  });

  it("adds a useful scheme to local and public hosts", () => {
    expect(resolveBrowserInput("localhost:5173/app")).toBe(
      "http://localhost:5173/app",
    );
    expect(resolveBrowserInput("127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000",
    );
    expect(resolveBrowserInput("example.com/docs")).toBe(
      "https://example.com/docs",
    );
  });

  it("turns free-form input into a search", () => {
    expect(resolveBrowserInput("electron web contents view")).toBe(
      "https://www.google.com/search?q=electron%20web%20contents%20view",
    );
    expect(resolveBrowserInput("mains")).toBe(
      "https://www.google.com/search?q=mains",
    );
  });

  it("refuses explicit unsupported protocols", () => {
    expect(resolveBrowserInput("file:///etc/passwd")).toBe(BLANK_URL);
    expect(resolveBrowserInput("ftp://example.com/file")).toBe(BLANK_URL);
  });
});

describe("classifyBrowserInput", () => {
  it("tells an address from a search", () => {
    expect(classifyBrowserInput("localhost:3000/writing/")).toEqual({
      kind: "address",
      url: "http://localhost:3000/writing/",
    });
    expect(classifyBrowserInput("example.com").kind).toBe("address");
    expect(classifyBrowserInput("electron web contents view").kind).toBe(
      "search",
    );
  });

  it("counts a search engine URL typed out in full as an address", () => {
    expect(
      classifyBrowserInput("https://www.google.com/search?q=mains").kind,
    ).toBe("address");
  });
});

describe("isAllowedBrowserUrl", () => {
  it("accepts only the embedded browser protocol allowlist", () => {
    expect(isAllowedBrowserUrl("https://example.com")).toBe(true);
    expect(isAllowedBrowserUrl("http://localhost:3000")).toBe(true);
    expect(isAllowedBrowserUrl("about:blank")).toBe(true);
    expect(isAllowedBrowserUrl("file:///tmp/a")).toBe(false);
    expect(isAllowedBrowserUrl("not a url")).toBe(false);
  });
});

