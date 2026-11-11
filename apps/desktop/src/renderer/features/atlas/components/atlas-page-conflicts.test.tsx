// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AtlasPage } from "@mains/contracts/atlas";
import { AtlasPageConflicts } from "./atlas-page-conflicts";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useAtlasRevisionQuery: (input: unknown, options: unknown) => {
    mocks.preview(input, options); return { data: { id: "other", title: "Other branch", markdown: "Offline changes" } };
  },
}));
vi.mock("@/components/ui", async (original) => ({ ...await original<typeof import("@/components/ui")>(), toast: { error: mocks.error } }));
const page = { item: { id: "page", accountId: "account", version: 3 }, revision: { id: "current" },
  conflicts: [{ id: "other", title: "Other branch", backendId: "B", backendLabel: "iPad backend", createdAt: "2026-10-15T12:00:00Z" }] } as AtlasPage;
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

it.each(["current", "other"] as const)("previews the other UUID and passes the %s choice to the page lifecycle", async (choice) => {
  const resolve = vi.fn().mockResolvedValue(true);
  render(<AtlasPageConflicts page={page} onResolve={resolve} resolving={false} />);
  expect(mocks.preview).toHaveBeenLastCalledWith({ accountId: "account", id: "page", revisionId: "other" }, { skip: true });
  fireEvent.click(screen.getByRole("button", { name: "View the other version" }));
  expect(screen.getByText("Offline changes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: choice === "current" ? "Keep current version" : "Use the other version" }));
  await waitFor(() => expect(resolve).toHaveBeenCalledExactlyOnceWith(choice, "other"));
  expect(screen.queryByRole("dialog", { name: "Choose a version" })).toBeNull();
});

it("preserves a blocked local draft and leaves the conflict unresolved", async () => {
  const resolve = vi.fn().mockResolvedValue(false);
  render(<AtlasPageConflicts page={page} onResolve={resolve} resolving={false} />);
  fireEvent.click(screen.getByRole("button", { name: "View the other version" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep current version" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(resolve).toHaveBeenCalledOnce();
  expect(screen.getByRole("dialog", { name: "Choose a version" })).toBeTruthy();
});
