// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueWithEntity } from "@/lib/redux/api";
import { formatIssueDate, IssueRow, PriorityIcon } from "./issue-row";

afterEach(cleanup);

function row(issue: Partial<IssueWithEntity["issue"]> = {}): IssueWithEntity {
  return {
    issue: {
      entityId: "e1",
      provider: "linear",
      state: "Todo",
      stateId: "s",
      statusId: "todo",
      number: 200,
      identifier: "MAI-200",
      repo: "MAI",
      assignee: "Okan",
      assigneeAvatarUrl: "https://example.com/okan.png",
      labels: JSON.stringify(["Feature", "Desktop", "Bug"]),
      labelColors: JSON.stringify({ Feature: "#9f8fef", Bug: "url(x)" }),
      groupName: "Mobile",
      groupColor: "#5e6ad2",
      dueAt: null,
      closedAt: null,
      priority: 1,
      ...issue,
    },
    entity: { id: "e1", title: "Windows & Linux", occurredAt: "2025-09-12T10:00:00Z" } as IssueWithEntity["entity"],
  };
}

const TODO = { id: "todo", name: "Todo", category: "open" as const, sortOrder: 1 };

describe("IssueRow", () => {
  it("lays out a Linear issue like Linear: priority, status, title, labels, group", () => {
    render(<IssueRow row={row()} status={TODO} isActive={false} showProvider={false} showPriority onClick={() => {}} />);

    expect(screen.getByRole("img", { name: "Urgent" })).toBeTruthy();
    // The identifier is searchable, not drawn.
    expect(screen.queryByText("MAI-200")).toBeNull();
    expect(screen.getByRole("img", { name: "Todo" })).toBeTruthy();
    expect(screen.getByText("Windows & Linux")).toBeTruthy();
    expect(screen.getByText("Feature")).toBeTruthy();
    expect(screen.getByText("Desktop")).toBeTruthy();
    // Past two labels the rest collapse.
    expect(screen.queryByText("Bug")).toBeNull();
    expect(screen.getByText("+1").closest("[title]")?.getAttribute("title")).toBe("Bug");
    expect(screen.getByText("Mobile")).toBeTruthy();
    // No assignee, not even with a photo — the filter menu narrows by it.
    expect(screen.queryByRole("img", { name: "Okan" })).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("colors every label from its name, and paints a group color only when it is a plain hex", () => {
    const { container } = render(
      <IssueRow
        row={row({ labels: JSON.stringify(["Feature", "Bug"]), labelColors: null, groupColor: "url(x)" })}
        status={TODO}
        isActive={false}
        showProvider={false}
        showPriority
        onClick={() => {}}
      />,
    );
    const dots = [...container.querySelectorAll<HTMLElement>("span[style]")].map((dot) => dot.style.backgroundColor);
    // Both labels get a dot without any provider colors; the group's "url(x)" never paints.
    expect(dots).toHaveLength(2);
    expect(dots.every(Boolean)).toBe(true);
  });

  it("marks the group with a cube in its color, not a label's dot", () => {
    render(
      <IssueRow
        row={row({ labels: null })}
        status={TODO}
        isActive={false}
        showProvider={false}
        showPriority
        onClick={() => {}}
      />,
    );
    const pill = screen.getByText("Mobile").closest("span[class*='rounded-full']")!;
    expect(pill.querySelector("span[style]")).toBeNull();
    expect(pill.querySelector<SVGElement>("svg")?.style.color).toBe("rgb(94, 106, 210)");
  });

  it("draws only what a provider has: a GitHub issue without priority or group", () => {
    render(
      <IssueRow
        row={row({
          provider: "github",
          identifier: "#42",
          priority: 0,
          labels: null,
          labelColors: null,
          groupName: null,
          assignee: null,
        })}
        status={TODO}
        isActive={false}
        showProvider
        showPriority={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByText("#42")).toBeNull();
    expect(screen.queryByRole("img", { name: /Urgent|High|Medium|Low/ })).toBeNull();
    expect(screen.queryByText("Mobile")).toBeNull();
  });

  it("opens on click and on Enter", () => {
    const onClick = vi.fn();
    render(<IssueRow row={row()} status={TODO} isActive={false} showProvider={false} showPriority onClick={onClick} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe("PriorityIcon", () => {
  it("names each level and draws nothing for no priority", () => {
    const { container, rerender } = render(<PriorityIcon priority={3} />);
    expect(screen.getByRole("img", { name: "Medium" })).toBeTruthy();
    rerender(<PriorityIcon priority={0} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("formatIssueDate", () => {
  it("drops the year inside the current one and shortens it outside", () => {
    const now = new Date("2025-10-30T00:00:00Z");
    expect(formatIssueDate("2025-09-12T10:00:00Z", now)).toBe("Sep 12");
    expect(formatIssueDate("2024-09-12T10:00:00Z", now)).toBe("Sep 12 ’24");
    expect(formatIssueDate(null, now)).toBeNull();
    // A due date is a calendar day in any timezone.
    expect(formatIssueDate("2025-03-01", now)).toBe("Mar 1");
  });
});
