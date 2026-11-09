// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Select from "./select";

const options = [{ value: "react", label: "React" }, { value: "typescript", label: "TypeScript" }, { value: "css", label: "CSS" }];
function Multiple({ onSubmit = vi.fn(), onCreate = (name: string) => name, maxSelected }: {
  onSubmit?: () => void; onCreate?: (name: string) => string; maxSelected?: number;
}) {
  const [value, setValue] = useState<string[]>([]);
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <Select aria-label="Topics" multiple value={value} onChange={setValue} options={options}
      placeholder="Choose topics" searchPlaceholder="Search topics" onCreateOption={onCreate} maxSelected={maxSelected} />
    <output aria-label="Selected values">{JSON.stringify(value)}</output>
  </form>;
}
beforeEach(() => {
  document.documentElement.style.fontSize = "16px";
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Select", () => {
  it("keeps single selection behavior and closes after choosing an option", () => {
    function Single() {
      const [value, setValue] = useState("react");
      return <Select aria-label="Topic" value={value} onChange={setValue} options={options} />;
    }
    render(<Single />);
    fireEvent.click(screen.getByRole("button", { name: "Topic" }));
    fireEvent.click(screen.getByRole("option", { name: "TypeScript" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Topic" }).textContent).toContain("TypeScript");
  });
  it("selects and deselects several options without closing the list", () => {
    render(<Multiple />);
    fireEvent.click(screen.getByRole("button", { name: "Topics" }));
    expect(screen.getByRole("listbox").getAttribute("aria-multiselectable")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "React" }));
    fireEvent.click(screen.getByRole("option", { name: "TypeScript" }));
    expect(screen.getByRole("option", { name: "React" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "TypeScript" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "React" }));
    expect(screen.getByLabelText("Selected values").textContent).toBe('["typescript"]');
    expect(screen.getByRole("listbox")).toBeTruthy();
  });
  it("keeps the list attached when its enclosing layout resizes", async () => {
    let resize!: ResizeObserverCallback;
    const observe = vi.fn(), disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const { unmount } = render(<Multiple />);
    const trigger = screen.getByRole("button", { name: "Topics" });
    let bottom = 300;
    vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() =>
      ({ bottom, left: 80, width: 400 }) as DOMRect);
    fireEvent.click(trigger);
    const dropdown = screen.getByRole("listbox").parentElement!;
    expect(dropdown.style.top).toBe("300px");
    // A centered dialog moves its trigger when content below it changes height.
    bottom = 284;
    expect(observe).toHaveBeenCalledWith(trigger.closest("form"));
    resize([], {} as ResizeObserver);
    await waitFor(() => expect(dropdown.style.top).toBe("284px"));
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it("creates a typed option with Enter and resolves an existing label without creating duplicates", () => {
    const submit = vi.fn(), create = vi.fn((name: string) => name);
    render(<Multiple onSubmit={submit} onCreate={create} />);
    fireEvent.click(screen.getByRole("button", { name: "Topics" }));
    const search = screen.getByRole("searchbox", { name: "Search topics" });
    fireEvent.change(search, { target: { value: "Design" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(create).toHaveBeenCalledWith("Design");
    expect((search as HTMLInputElement).value).toBe("");
    fireEvent.change(search, { target: { value: "rEaCt" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Selected values").textContent).toBe('["Design","react"]');
    expect(submit).not.toHaveBeenCalled();
  });
  it("supports keyboard selection and Escape without submitting the enclosing form", async () => {
    const user = userEvent.setup(), submit = vi.fn();
    render(<Multiple onSubmit={submit} />);
    const trigger = screen.getByRole("button", { name: "Topics" });
    await user.click(trigger);
    await user.type(screen.getByRole("searchbox", { name: "Search topics" }), "rea");
    await user.keyboard("{ArrowDown} ");
    expect(screen.getByLabelText("Selected values").textContent).toBe('["react"]');
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(submit).not.toHaveBeenCalled();
  });
  it("enforces the selection limit while allowing removal and another selection", () => {
    render(<Multiple maxSelected={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Topics" }));
    fireEvent.click(screen.getByRole("option", { name: "React" }));
    fireEvent.click(screen.getByRole("option", { name: "TypeScript" }));
    expect((screen.getByRole("option", { name: "CSS" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove React" }));
    fireEvent.click(screen.getByRole("option", { name: "CSS" }));
    expect(screen.getByLabelText("Selected values").textContent).toBe('["typescript","css"]');
  });
});
