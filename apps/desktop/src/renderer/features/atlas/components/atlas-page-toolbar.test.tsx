// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtlasPageToolbar } from "./atlas-page-toolbar";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Atlas Page toolbar submenus", () => {
  it.each([
    { label: "Export", option: "Markdown", role: "menuitem", action: { type: "export", format: "markdown" } },
    { label: "Move to", option: "Launch", role: "menuitemradio", action: { type: "move", collectionId: "project" } },
  ])("opens $label from right to left and retains its action", ({ label, option, role, action }) => {
    vi.stubGlobal("innerWidth", 1_200);
    vi.stubGlobal("innerHeight", 800);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(180);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 970, y: 180, left: 970, right: 1_170, top: 180, bottom: 210,
      width: 200, height: 30, toJSON: () => ({}),
    });
    const onAction = vi.fn();
    render(<AtlasPageToolbar title="Notes" isFavorite={false} trashed={false}
      collectionId={null} collections={[{ id: "project", name: "Launch" }]}
      onBack={vi.fn()} onFavorite={vi.fn()} onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "Page options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    const submenu = screen.getByRole("menu", { name: label });
    expect(submenu.style.transformOrigin).toBe("top right");
    expect(submenu.style.left).toBe("766px");
    fireEvent.click(screen.getByRole(role, { name: option }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(action);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
