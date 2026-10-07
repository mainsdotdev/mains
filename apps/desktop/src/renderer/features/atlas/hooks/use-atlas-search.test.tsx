// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Input } from "@/components/ui";
import { useAtlasSearch } from "./use-atlas-search";

function SearchHarness() {
  const [value, setValue] = useAtlasSearch();
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <Input aria-label="Search Atlas" value={value} onChange={(event) => setValue(event.target.value)} />
    <output data-testid="url">{location.pathname}{location.search}</output>
    <button onClick={() => navigate("/atlas?type=file")}>Docs</button>
    <button onClick={() => navigate(-1)}>Back</button>
  </>;
}

function setup(initialEntries = ["/atlas"], initialIndex?: number) {
  render(<MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}><SearchHarness /></MemoryRouter>);
  return screen.getByRole("textbox", { name: "Search Atlas" }) as HTMLInputElement;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Atlas search navigation", () => {
  it.each(["saved", "uploads"])("keeps fast typing intact and preserves the %s filter in the search URL", async (scope) => {
    const input = setup([`/atlas?type=file&view=${scope}&project=mains&focus=search`]);
    let value = "";
    for (const character of "missing-result") {
      value += character;
      fireEvent.change(input, { target: { value } });
    }
    expect(input.value).toBe("missing-result");
    await act(async () => vi.advanceTimersByTime(300));
    expect(input.value).toBe("missing-result");
    const url = new URL(screen.getByTestId("url").textContent!, "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ type: "file", view: scope, project: "mains", q: "missing-result" });
  });

  it("cancels an unfinished search when the user changes categories", async () => {
    const input = setup();
    fireEvent.change(input, { target: { value: "old query" } });
    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
    await act(async () => vi.advanceTimersByTime(300));
    expect(input.value).toBe("");
    expect(screen.getByTestId("url").textContent).toBe("/atlas?type=file");
  });

  it("restores the search from history and treats all as a search term", async () => {
    const input = setup(["/atlas?q=previous", "/atlas?type=file"], 1);
    fireEvent.change(input, { target: { value: "all" } });
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByTestId("url").textContent).toBe("/atlas?type=file&q=all");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(input.value).toBe("previous");
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByTestId("url").textContent).toBe("/atlas?q=previous");
  });
});
