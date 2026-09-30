// @vitest-environment jsdom

import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mode-config", () => ({
  useModeConfig: () => ({
    showPermissionControls: true,
    showPlanControls: true,
    showGoalControls: false,
    showPluginsButton: false,
  }),
}));

import { InputToolbar } from "./input-toolbar";

describe("browser composer controls", () => {
  it("keeps attachment, model and effort, permissions, and send in one row", () => {
    const onSubmit = vi.fn();
    const props: Parameters<typeof InputToolbar>[0] = {
      variant: "codex",
      layout: "browser",
      isLoading: false,
      onSubmit,
      onGoalChange: vi.fn(),
      selectedModelDisplayName: "gpt-5",
      modelDisplayNames: ["gpt-5"],
      modelEffortLevelsByDisplayName: { "gpt-5": ["medium"] },
      onModelChange: vi.fn(),
      isLoadingModels: false,
      permissionMode: "workspace-write",
      onPermissionModeChange: vi.fn(),
      thinkingMode: true,
      onThinkingModeToggle: vi.fn(),
      fastMode: false,
      onFastModeToggle: vi.fn(),
      supportsFastMode: false,
      effortLevel: "medium",
      onEffortLevelChange: vi.fn(),
      isRunning: false,
      uploadedFiles: [],
      onUploadedFilesChange: vi.fn(),
    };
    const { rerender } = render(createElement(InputToolbar, props));

    const controls = [
      screen.getByRole("button", { name: "Upload file" }),
      screen.getByRole("button", { name: "Model and effort" }),
      screen.getByRole("button", { name: "Permission mode" }),
      screen.getByRole("button", { name: "Send prompt" }),
    ];
    for (let i = 0; i < controls.length - 1; i++) {
      expect(controls[i].compareDocumentPosition(controls[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    fireEvent.click(controls[1]);
    expect(controls[1].getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("menu", { name: "Model selection" }).className,
    ).toContain("right-0");
    fireEvent.click(controls[2]);
    expect(controls[2].getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("menu", { name: "Permission mode" }).className,
    ).toContain("right-0");
    const selectedIcon = () => screen.getByRole("menu", { name: "Permission mode" })
      .querySelector('[role="menuitemradio"][aria-checked="true"] svg')?.innerHTML;
    expect(controls[2].querySelector("svg")?.innerHTML).toBe(selectedIcon());
    const writeIcon = controls[2].querySelector("svg")?.innerHTML;
    rerender(createElement(InputToolbar, { ...props, permissionMode: "read-only" }));
    expect(controls[2].querySelector("svg")?.innerHTML).toBe(selectedIcon());
    expect(controls[2].querySelector("svg")?.innerHTML).not.toBe(writeIcon);
    fireEvent.click(controls[3]);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("closes browser menus and the effort submenu when focus mode changes", () => {
    const props: Parameters<typeof InputToolbar>[0] = {
      variant: "codex",
      layout: "browser",
      browserChatMode: "details",
      isLoading: false,
      onSubmit: vi.fn(),
      onGoalChange: vi.fn(),
      selectedModelDisplayName: "gpt-5",
      modelDisplayNames: ["gpt-5"],
      modelEffortLevelsByDisplayName: { "gpt-5": ["medium"] },
      onModelChange: vi.fn(),
      isLoadingModels: false,
      permissionMode: "workspace-write",
      onPermissionModeChange: vi.fn(),
      thinkingMode: true,
      onThinkingModeToggle: vi.fn(),
      fastMode: false,
      onFastModeToggle: vi.fn(),
      supportsFastMode: false,
      effortLevel: "medium",
      onEffortLevelChange: vi.fn(),
      isRunning: false,
      uploadedFiles: [],
      onUploadedFilesChange: vi.fn(),
    };
    const { rerender } = render(createElement(InputToolbar, props));
    const model = screen.getByRole("button", { name: "Model and effort" });
    const permission = screen.getByRole("button", { name: "Permission mode" });
    const attachment = screen.getByRole("button", { name: "Upload file" });

    fireEvent.click(attachment);
    fireEvent.click(model);
    fireEvent.mouseEnter(screen.getByRole("menuitemradio", { checked: true }));
    fireEvent.click(permission);
    expect(screen.getAllByRole("menu").length).toBeGreaterThanOrEqual(3);

    rerender(createElement(InputToolbar, { ...props, browserChatMode: "input" }));
    expect(screen.queryAllByRole("menu")).toHaveLength(0);
    expect(model.getAttribute("aria-expanded")).toBe("false");
    expect(permission.getAttribute("aria-expanded")).toBe("false");
    expect(attachment.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(model);
    expect(screen.getByRole("menu", { name: "Model selection" })).toBeTruthy();
    expect(screen.queryByRole("menu", { name: /effort level/i })).toBeNull();

    rerender(createElement(InputToolbar, { ...props, browserChatMode: "icon" }));
    expect(screen.queryAllByRole("menu")).toHaveLength(0);
  });
});
