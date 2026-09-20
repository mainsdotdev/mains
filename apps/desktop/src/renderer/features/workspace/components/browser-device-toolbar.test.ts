// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDeviceToolbar } from "./browser-device-toolbar";

afterEach(cleanup);
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("BrowserDeviceToolbar", () => {
  it("lets an open Select join its trigger to the option list", () => {
    render(
      createElement(BrowserDeviceToolbar, {
        device: {
          enabled: true,
          presetId: "responsive",
          width: 393,
          height: 852,
          deviceScaleFactor: 2,
          scale: 0.84,
        },
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    const trigger = screen.getByRole("button", { name: "Device preset" });
    fireEvent.click(trigger);

    expect(trigger.className).toContain("rounded-t-xl");
    expect(trigger.parentElement?.parentElement?.className).not.toContain(
      "[&>div>button]:rounded-xl",
    );
  });

  it("uses theme-aware dimension steppers instead of native controls", () => {
    const onChange = vi.fn();
    render(
      createElement(BrowserDeviceToolbar, {
        device: {
          enabled: true,
          presetId: "responsive",
          width: 393,
          height: 852,
          deviceScaleFactor: 2,
          scale: 0.84,
        },
        onChange,
        onClose: vi.fn(),
      }),
    );

    const widthInput = screen.getByRole("spinbutton", {
      name: "Viewport width",
    });
    expect(widthInput.className).toContain(
      "[&::-webkit-inner-spin-button]:appearance-none",
    );
    const increaseWidth = screen.getByRole("button", {
      name: "Increase viewport width",
    });
    expect(increaseWidth).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Decrease viewport width" }),
    ).toBeTruthy();

    fireEvent.click(increaseWidth);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ presetId: "responsive", width: 394 }),
    );
  });
});
