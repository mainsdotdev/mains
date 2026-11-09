// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installOverlayFrameClock } from "@/lib/overlay-test-fixtures";
import Select from "./select";
import DropdownWrapper from "./dropdown-wrapper";
import { Modal } from "./modal";
import { useState } from "react";
import { StrictMode } from "react";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSub } from "./dropdown-menu";

const readiness = vi.hoisted(() => ({ ready: true }));
vi.mock("@/lib/app-ready", () => ({ isAppReady: () => readiness.ready }));

let frames: ReturnType<typeof installOverlayFrameClock>;
beforeEach(() => { readiness.ready = true; frames = installOverlayFrameClock(); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("does not let a dismissed Select steal focus from its reopened list", () => {
  render(<Select aria-label="Topic" value="one" options={[{ value: "one", label: "First" }, { value: "two", label: "Second" }]} onChange={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Topic" });
  fireEvent.click(trigger); fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const option = screen.getByRole("option", { name: "First" }); expect(document.activeElement).toBe(option);
  act(() => frames.flush()); expect(document.activeElement).toBe(option);
});

it("shows an initially open dropdown immediately before app readiness without waiting for frames", () => {
  readiness.ready = false;
  render(<DropdownWrapper isOpen><button>Action</button></DropdownWrapper>);
  expect(screen.getByRole("menu").className).not.toContain("dropdown-prewarm");
  expect(frames.count()).toBe(0);
});

it("preserves focus handed to another control by a Select action", () => {
  render(<><Select aria-label="Topic" value="one" options={[{ value: "one", label: "First" }]} onChange={() => screen.getByRole("textbox").focus()} /><input aria-label="New editor" /></>);
  fireEvent.click(screen.getByRole("button", { name: "Topic" }));
  fireEvent.click(screen.getByRole("option", { name: "First" }));
  act(() => frames.flush()); expect(document.activeElement).toBe(screen.getByRole("textbox"));
});

it("does not let a closing dialog reclaim focus from a newly focused editor", () => {
  const opener = document.createElement("button"); document.body.appendChild(opener); opener.focus();
  const onClose = vi.fn();
  const view = render(<><Modal isOpen onClose={onClose} aria-label="Dialog"><button>Dialog action</button></Modal><input aria-label="Editor" /></>);
  act(() => frames.flush());
  view.rerender(<><Modal isOpen={false} onClose={onClose} aria-label="Dialog"><button>Dialog action</button></Modal><input aria-label="Editor" /></>);
  const editor = screen.getByRole("textbox"); editor.focus(); act(() => frames.flush());
  try { expect(document.activeElement).toBe(editor); } finally { opener.remove(); }
});

it("retires a menu's deferred Tab movement when that menu is reopened", () => {
  function Menu() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open actions</button><DropdownMenu isOpen={open} onClose={() => setOpen(false)} position={{ x: 0, y: 0 }} aria-label="Actions"><DropdownMenuItem onClick={vi.fn()}>Action</DropdownMenuItem></DropdownMenu><input aria-label="Next" /></>;
  }
  render(<Menu />); const trigger = screen.getByRole("button", { name: "Open actions" }); trigger.focus();
  fireEvent.click(trigger); fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
  fireEvent.click(trigger); const action = screen.getByRole("menuitem");
  expect(document.activeElement).toBe(action); act(() => frames.flush()); expect(document.activeElement).toBe(action);
});

it("ignores a submenu close callback already queued before pointer re-entry", () => {
  vi.useFakeTimers(); const scheduled = vi.spyOn(globalThis, "setTimeout");
  render(<DropdownMenuSub label="Tools"><DropdownMenuItem onClick={vi.fn()}>Inspect</DropdownMenuItem></DropdownMenuSub>);
  const trigger = screen.getByRole("menuitem", { name: "Tools" }); fireEvent.mouseEnter(trigger); fireEvent.mouseLeave(trigger);
  const queued = [...scheduled.mock.calls].reverse().find((call) => call[1] === 150)?.[0]; expect(typeof queued).toBe("function");
  fireEvent.mouseEnter(screen.getByRole("menu")); act(() => { if (typeof queued === "function") queued(); });
  expect(screen.queryByRole("menu")).not.toBeNull();
});

it("requires a fresh two-frame entrance after a dropdown closes and reopens", () => {
  const view = render(<DropdownWrapper isOpen><button>Action</button></DropdownWrapper>);
  const retired = frames.take();
  view.rerender(<DropdownWrapper isOpen={false}><button>Action</button></DropdownWrapper>); expect(screen.queryByRole("menu")).toBeNull();
  view.rerender(<DropdownWrapper isOpen><button>Action</button></DropdownWrapper>);
  act(() => { for (const callback of retired) callback(0); });
  expect(frames.count()).toBe(1); act(() => frames.flush()); expect(screen.getByRole("menu").className).toContain("dropdown-prewarm");
  act(() => frames.flush()); expect(screen.getByRole("menu").className).not.toContain("dropdown-prewarm");
  view.unmount(); expect(frames.count()).toBe(0);
});

it("closes a disabled Select and balances its open notification exactly once", () => {
  const onOpenChange = vi.fn(), props = { "aria-label": "Topic", value: "one", options: [{ value: "one", label: "First" }], onChange: vi.fn(), onOpenChange };
  const view = render(<StrictMode><Select {...props} /></StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: "Topic" }));
  view.rerender(<StrictMode><Select {...props} disabled /></StrictMode>);
  expect(screen.queryByRole("listbox")).toBeNull(); expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  view.rerender(<StrictMode><Select {...props} /></StrictMode>); fireEvent.click(screen.getByRole("button", { name: "Topic" }));
  view.unmount(); expect(onOpenChange.mock.calls).toEqual([[true], [false], [true], [false]]); expect(frames.count()).toBe(0);
});

it("ignores a dialog entry frame from its previous opening", () => {
  const onClose = vi.fn();
  const body = <><button>First field</button><button>Second field</button></>;
  const view = render(<Modal isOpen onClose={onClose} aria-label="Dialog">{body}</Modal>);
  const retired = frames.take(); view.rerender(<Modal isOpen={false} onClose={onClose} aria-label="Dialog">{body}</Modal>);
  view.rerender(<Modal isOpen onClose={onClose} aria-label="Dialog">{body}</Modal>);
  const field = screen.getByRole("button", { name: "Second field" }); field.focus();
  act(() => { for (const callback of retired) callback(0); }); expect(document.activeElement).toBe(field);
});
