// @vitest-environment jsdom

import { createElement, createRef, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { SegmentedTabs } from "./segmented-tabs";
import { Slider } from "./slider";
import { Toggle } from "./toggle";

const CONNECTION_OPTIONS = [
  { value: "direct", label: "Direct URL" },
  { value: "ssh", label: "SSH tunnel" },
] as const;
type ConnectionMode = (typeof CONNECTION_OPTIONS)[number]["value"];

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("interactive UI controls", () => {
  it("dispatches Button clicks while suppressing disabled and loading clicks", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      createElement(Button, { onClick }, "Save"),
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(createElement(Button, { onClick, disabled: true }, "Save"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    rerender(createElement(Button, { onClick, isLoading: true }, "Save"));
    await user.click(screen.getByRole("button", { name: "Loading..." }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("forwards the Checkbox input ref and emits the next checked state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const ref = createRef<HTMLInputElement>();
    const { rerender } = render(
      createElement(Checkbox, {
        ref,
        checked: false,
        onChange,
        "aria-label": "Include worktree",
      }),
    );
    const checkbox = screen.getByRole("checkbox", {
      name: "Include worktree",
    });

    expect(ref.current).toBe(checkbox);
    await user.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(
      createElement(Checkbox, {
        checked: true,
        disabled: true,
        onChange,
        "aria-label": "Include worktree",
      }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Include worktree" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("toggles in both directions and stays inert while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      createElement(Toggle, {
        enabled: false,
        label: "Allow web search",
        onChange,
      }),
    );

    await user.click(screen.getByRole("switch", { name: "Allow web search" }));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(
      createElement(Toggle, {
        enabled: true,
        label: "Allow web search",
        onChange,
      }),
    );
    await user.click(screen.getByRole("switch", { name: "Allow web search" }));
    expect(onChange).toHaveBeenLastCalledWith(false);

    rerender(
      createElement(Toggle, {
        enabled: true,
        disabled: true,
        label: "Allow web search",
        onChange,
      }),
    );
    await user.click(screen.getByRole("switch", { name: "Allow web search" }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("parses Slider changes and commits the latest controlled value", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const sliderProps = {
      min: 10,
      max: 20,
      showValue: false,
      onChange,
      onCommit,
      "aria-label": "Interface size",
    } as const;
    const { rerender } = render(
      createElement(Slider, { ...sliderProps, value: 12 }),
    );
    const range = screen.getByRole("slider", { name: "Interface size" });

    fireEvent.change(range, { target: { value: "14" } });
    expect(onChange).toHaveBeenLastCalledWith(14);

    rerender(createElement(Slider, { ...sliderProps, value: 14 }));
    fireEvent.keyUp(range, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenLastCalledWith(14);

    fireEvent.mouseDown(range);
    rerender(createElement(Slider, { ...sliderProps, value: 17 }));
    fireEvent.mouseUp(window);
    expect(onCommit).toHaveBeenLastCalledWith(17);
  });

  it("updates SegmentedTabs selection and focus through the keyboard", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<ConnectionMode>("direct");
      return createElement(SegmentedTabs<ConnectionMode>, {
        value,
        onChange: setValue,
        options: CONNECTION_OPTIONS,
        semantics: "radiogroup",
        "aria-label": "Backend connection method",
      });
    }

    render(createElement(Harness));
    const direct = screen.getByRole("radio", { name: "Direct URL" });
    const ssh = screen.getByRole("radio", { name: "SSH tunnel" });
    direct.focus();

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(ssh);
    expect(ssh.getAttribute("aria-checked")).toBe("true");
    expect(direct.tabIndex).toBe(-1);

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(direct);
    expect(direct.getAttribute("aria-checked")).toBe("true");
  });
});
