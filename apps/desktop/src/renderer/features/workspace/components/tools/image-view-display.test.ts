// @vitest-environment jsdom

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageViewDisplay } from "./image-view-display";

vi.mock("@/hooks/use-local-image-url", () => ({
  useLocalImageUrl: () => "mains-localimg://preview/page-1.png",
}));

describe("ImageViewDisplay", () => {
  it("shows an inspected page as a small tool thumbnail", () => {
    render(createElement(ImageViewDisplay, { params: { path: "/tmp/pdfs/page-1.png" } }));

    expect(screen.getByText("Viewed")).toBeTruthy();
    expect(screen.getByText("page-1.png")).toBeTruthy();
    const thumbnail = screen.getByRole("img", { name: "page-1.png" });
    expect(thumbnail.getAttribute("src")).toBe("mains-localimg://preview/page-1.png");
    expect(thumbnail.className).toContain("max-h-32");
  });
});
