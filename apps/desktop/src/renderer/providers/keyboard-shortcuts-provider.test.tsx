// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Input } from "@/components/ui";
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcut,
} from "./keyboard-shortcuts-provider";

function ShortcutTarget({ onRun }: { onRun: () => void }) {
  useKeyboardShortcut("app.openSettings", onRun);
  return (
    <div>
      <Input aria-label="Editable" />
      <button data-shortcut-recorder="true">Recorder</button>
    </div>
  );
}

describe("KeyboardShortcutsProvider", () => {
  it("dispatches the current app binding", () => {
    const onRun = vi.fn();
    render(
      <KeyboardShortcutsProvider>
        <ShortcutTarget onRun={onRun} />
      </KeyboardShortcutsProvider>,
    );

    fireEvent.keyDown(window, {
      code: "KeyS",
      key: "s",
      metaKey: true,
      shiftKey: true,
    });

    expect(onRun).toHaveBeenCalledOnce();
  });

  it("does not steal shortcuts from editable or recorder targets", () => {
    const onRun = vi.fn();
    const view = render(
      <KeyboardShortcutsProvider>
        <ShortcutTarget onRun={onRun} />
      </KeyboardShortcutsProvider>,
    );

    fireEvent.keyDown(view.getByLabelText("Editable"), {
      code: "KeyS",
      key: "s",
      metaKey: true,
      shiftKey: true,
    });
    fireEvent.keyDown(view.getByText("Recorder"), {
      code: "KeyS",
      key: "s",
      metaKey: true,
      shiftKey: true,
    });

    expect(onRun).not.toHaveBeenCalled();
  });
});
