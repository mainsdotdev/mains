// @vitest-environment jsdom

import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserClearDataPanel } from "./browser-clear-data-panel";

afterEach(cleanup);

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("BrowserClearDataPanel", () => {
  it("submits the selected time range and data categories", async () => {
    const onClear = vi.fn().mockResolvedValue(false);
    render(
      createElement(BrowserClearDataPanel, {
        onBack: vi.fn(),
        onClear,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Browsing data time range" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Last hour" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Download history" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Clear data/ }));

    await waitFor(() => {
      expect(onClear).toHaveBeenCalledWith({
        timeRange: "last-hour",
        history: true,
        cookiesAndSiteData: true,
        cache: true,
        downloads: false,
      });
    });
    expect(
      screen.getByText(/Cookies, site data, and cache are cleared for all time/),
    ).toBeTruthy();
  });

  it("disables clearing when every category is unchecked", () => {
    render(
      createElement(BrowserClearDataPanel, {
        onBack: vi.fn(),
        onClear: vi.fn().mockResolvedValue(false),
      }),
    );

    for (const label of [
      "Browsing history",
      "Cookies and site data",
      "Cached images and files",
      "Download history",
    ]) {
      fireEvent.click(screen.getByRole("checkbox", { name: label }));
    }

    expect(
      (screen.getByRole("menuitem", {
        name: /Clear data/,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
