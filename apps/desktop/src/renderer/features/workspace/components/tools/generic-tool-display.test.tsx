// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GenericToolDisplay } from "./generic-tool-display";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("formats only opened details, offers full output and releases it after closing", () => {
  vi.useFakeTimers();
  const serialize = vi.fn(() => "x".repeat(5000) + "THE_END");
  const { container } = render(<GenericToolDisplay icon={null} displayName="Unknown tool" params={{ description: "Inspect" }} output={{ toJSON: serialize }} />);
  expect(serialize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Inspect"));
  expect(serialize).toHaveBeenCalled();
  expect(container.textContent).not.toContain("THE_END");
  fireEvent.click(screen.getByText("Show full content"));
  expect(container.textContent).toContain("THE_END");
  fireEvent.click(screen.getByText("Inspect"));
  act(() => vi.advanceTimersByTime(200));
  expect(container.querySelector("pre")).toBeNull();
});
