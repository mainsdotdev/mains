// @vitest-environment jsdom

import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageViewDisplay } from "./image-view-display";

vi.mock("@/hooks/use-local-image-url", () => ({
  useLocalImageUrl: () => "mains-localimg://preview/page-1.png",
}));

describe("ImageViewDisplay", () => {
  it("starts collapsed and shows an inspected page thumbnail when opened", () => {
    render(createElement(ImageViewDisplay, { params: { path: "/tmp/pdfs/page-1.png" } }));

    expect(screen.getByText("Viewed")).toBeTruthy();
    expect(screen.getByText("page-1.png")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "page-1.png" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Viewed.*page-1\.png/ }));
    const thumbnail = screen.getByRole("img", { name: "page-1.png" });
    expect(thumbnail.getAttribute("src")).toBe("mains-localimg://preview/page-1.png");
    expect(thumbnail.className).toContain("max-h-32");
  });
});
