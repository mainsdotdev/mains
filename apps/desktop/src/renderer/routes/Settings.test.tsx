// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/features/settings/components/settings-layout", () => ({
  SettingsPageShell: ({ title }: { title: string }) => <div>loading {title}</div>,
}));
vi.mock("@/features/settings/settings-sections", () => ({
  getSettingsRouteId: (value: string | null) => value ?? "general",
  getSettingsSection: (id: string) => ({
    id,
    label: id,
    Component: () => <div>section {id}</div>,
  }),
}));

import SettingsPage from "./Settings";

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tasks" element={<div>tasks page</div>} />
        <Route path="/bridge" element={<div>bridge page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("SettingsPage", () => {
  it("sends the hidden Connections section to /tasks", () => {
    renderAt("/settings?section=connections");
    expect(screen.getByText("tasks page")).toBeTruthy();
  });

  it("still renders the other sections", () => {
    renderAt("/settings?section=general");
    expect(screen.getByText("section general")).toBeTruthy();
  });
});
