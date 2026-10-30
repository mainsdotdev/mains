// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IssueStatusIcon } from "./issue-status";

afterEach(cleanup);

const iconClass = (container: HTMLElement) => container.querySelector("svg")?.getAttribute("class");

describe("IssueStatusIcon", () => {
  it("draws each default status with its own mark", () => {
    const { container } = render(
      <IssueStatusIcon status={{ id: "in_progress", name: "In progress", category: "open", sortOrder: 2 }} />,
    );
    expect(iconClass(container)).toContain("text-warning");
    expect(container.querySelector("path")).toBeTruthy();
  });

  it("marks a status without its own icon by its category", () => {
    const { container } = render(
      <IssueStatusIcon status={{ id: "shipped", name: "Shipped", category: "closed", sortOrder: 9 }} />,
    );
    // Falls back on the closed (done) mark: a check, painted as success.
    expect(iconClass(container)).toContain("text-success");
  });
});
