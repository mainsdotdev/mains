// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../shared/runtime-platform", () => ({ getRuntimeOS: () => "win32" }));
import { KeyboardShortcutsProvider, useKeyboardShortcut } from "./keyboard-shortcuts-provider";

function TerminalShortcut({ onRun }: { onRun: () => void }) {
  useKeyboardShortcut("app.toggleTerminal", onRun);
  return <button>Workspace</button>;
}
afterEach(cleanup);
describe("Windows shortcut dispatch", () => {
  it("opens the terminal with Ctrl+J", () => {
    const onRun = vi.fn();
    render(<KeyboardShortcutsProvider><TerminalShortcut onRun={onRun} /></KeyboardShortcutsProvider>);
    fireEvent.keyDown(window, { code: "KeyJ", key: "j", ctrlKey: true });
    expect(onRun).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { code: "KeyJ", key: "j", metaKey: true });
    expect(onRun).toHaveBeenCalledOnce();
  });
});
