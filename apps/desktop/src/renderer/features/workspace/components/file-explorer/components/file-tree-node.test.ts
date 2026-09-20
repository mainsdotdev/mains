// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileTreeNode } from "./file-tree-node";

afterEach(cleanup);

describe("FileTreeNode context action", () => {
  it("adds a directory to context without selecting or expanding it", async () => {
    const directory = {
      name: "apps",
      fullPath: "/repo/apps",
      type: "directory" as const,
      hasChildren: true,
    };
    const onAddToContext = vi.fn();
    const onSelect = vi.fn();
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();

    render(
      createElement(FileTreeNode, {
        node: directory,
        depth: 0,
        selectedPath: null,
        expandedPaths: new Set<string>(),
        onToggleExpand,
        onSelect,
        onAddToContext,
      }),
    );

    await user.click(screen.getByTitle("Add folder to context"));

    expect(onAddToContext).toHaveBeenCalledWith(directory);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("keeps the existing file context action", async () => {
    const file = {
      name: "index.ts",
      fullPath: "/repo/index.ts",
      type: "file" as const,
      hasChildren: false,
      extension: "ts",
    };
    const onAddToContext = vi.fn();
    const user = userEvent.setup();

    render(
      createElement(FileTreeNode, {
        node: file,
        depth: 0,
        selectedPath: null,
        expandedPaths: new Set<string>(),
        onToggleExpand: vi.fn(),
        onSelect: vi.fn(),
        onAddToContext,
      }),
    );

    await user.click(screen.getByTitle("Add to context"));

    expect(onAddToContext).toHaveBeenCalledWith(file);
  });
});
