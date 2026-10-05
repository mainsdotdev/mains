// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpAppIcon as IconMetadata } from "@mains/contracts/mcp-apps";
vi.mock("@/hooks/use-local-image-url", () => ({ useLocalImageUrl: (src: string | undefined) => src }));
import { McpAppIcon } from "./mcp-app-icon";

afterEach(cleanup);

describe("MCP app logo selection", () => {
  it.each([
    { src: "https://example.com/logo.svg?version=2" },
    { src: "https://example.com/asset/123", mimeType: "image/svg+xml" },
    { src: "data:image/svg+xml;base64,PHN2Zy8+" },
  ] satisfies IconMetadata[])("prefers the provided SVG $src over a raster composer icon", (svg) => {
    const { container } = render(<McpAppIcon isDarkMode icons={[{ src: "https://example.com/composer.png" }, svg]} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(svg.src);
  });

  it("selects the SVG for the current theme and switches when the theme changes", () => {
    const icons: IconMetadata[] = [{ src: "composer.png" },
      { src: "logo-light.svg", theme: "light" }, { src: "logo-dark.svg", theme: "dark" }];
    const { container, rerender } = render(<McpAppIcon icons={icons} isDarkMode />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("logo-dark.svg");
    rerender(<McpAppIcon icons={icons} isDarkMode={false} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("logo-light.svg");
  });

  it.each([false, true])("falls back when images fail, including monochrome=%s", (monochrome) => {
    const { container } = render(<McpAppIcon isDarkMode monochrome={monochrome} icons={[{ src: "composer.png" }, { src: "logo.svg" }]} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("composer.png");
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
