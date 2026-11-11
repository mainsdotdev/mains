// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AtlasItemTag } from "@mains/contracts/atlas";
import { AtlasItemTags } from "./atlas-item-tags";

const tags: AtlasItemTag[] = [
  "calculators", "developer tools", "file converters", "online utilities", "text tools", "reference",
].map((name, index) => ({ id: `tag-${index}`, name, source: index ? "ai" : "user" }));

afterEach(cleanup);

describe("Atlas hashtags", () => {
  it("exposes every hashtag directly and filters by its stable identity", () => {
    const onTag = vi.fn();
    render(<AtlasItemTags tags={tags} onTag={onTag} />);
    const row = screen.getByRole("group", { name: "Tags" });
    expect(within(row).getAllByRole("button").map((button) => button.textContent)).toEqual(tags.map((tag) => `#${tag.name}`));
    expect(screen.queryByRole("button", { name: /more tags/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "#reference" }));
    expect(onTag).toHaveBeenCalledWith("tag-5");
  });

  it("updates renamed tags and removes the row when all tags are removed", () => {
    const onTag = vi.fn();
    const { rerender } = render(<AtlasItemTags tags={tags} onTag={onTag} />);
    rerender(<AtlasItemTags tags={[{ ...tags[0], name: "Renamed tag" }]} onTag={onTag} />);
    expect(screen.queryByRole("button", { name: "#calculators" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "#Renamed tag" }));
    expect(onTag).toHaveBeenCalledWith("tag-0");
    rerender(<AtlasItemTags tags={[]} onTag={onTag} />);
    expect(screen.queryByRole("group")).toBeNull();
  });
});
