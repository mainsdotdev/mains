import { describe, expect, it } from "vitest";
import { fileBasename, fileHrefPath, isAbsoluteFilePath, markdownFileUrlTransform, resolveDocumentImagePath } from "./file-path";

describe("backend file paths in the renderer", () => {
  it("recognizes both backend OS families independent of the local client", () => {
    expect(isAbsoluteFilePath("C:\\Users\\Test User\\report.pdf")).toBe(true);
    expect(isAbsoluteFilePath("C:/Users/Test User/report.pdf")).toBe(true);
    expect(isAbsoluteFilePath("\\\\server\\share\\report.pdf")).toBe(true);
    expect(isAbsoluteFilePath("/home/user/report.pdf")).toBe(true);
    expect(isAbsoluteFilePath("C:relative.pdf")).toBe(false);
    expect(isAbsoluteFilePath("//example.com/report.pdf")).toBe(false);
    expect(fileBasename("C:\\Users\\Test User\\türkçe.pdf")).toBe("türkçe.pdf");
  });

  it("decodes local file URLs without admitting script or network file URLs", () => {
    expect(fileHrefPath("file:///C:/Test%20User/report%23one.pdf")).toBe("C:/Test User/report#one.pdf");
    expect(markdownFileUrlTransform("C:/Test%20User/report.pdf")).toBe("C:/Test%20User/report.pdf");
    expect(fileHrefPath(markdownFileUrlTransform("C:/Test%20User/report%2520.pdf")))
      .toBe("C:/Test User/report%20.pdf");
    expect(markdownFileUrlTransform("javascript:alert(1)")).toBe("");
    expect(markdownFileUrlTransform("c:script()")).toBe("");
    expect(fileHrefPath("file://example.com/secret.pdf")).toBe("");
  });

  it("resolves document images against Windows and POSIX file locations", () => {
    expect(resolveDocumentImagePath("../images/türkçe%20chart.png", "C:\\Test User\\docs\\report.md"))
      .toBe("C:/Test User/images/türkçe chart.png");
    expect(resolveDocumentImagePath("./chart.png", "/home/Test User/report.md"))
      .toBe("/home/Test User/chart.png");
    expect(resolveDocumentImagePath("../images/chart.png", "\\\\server\\share\\docs\\report.md"))
      .toBe("\\\\server\\share\\images\\chart.png");
  });
});
