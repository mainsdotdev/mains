import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Alert from "./alert";
import { Modal, ModalHeader } from "./modal";

vi.mock("react-dom", () => ({
  createPortal: (children: unknown) => children,
}));

beforeAll(() => {
  vi.stubGlobal("document", { body: {} });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("accessible dialog primitives", () => {
  it("links a ModalHeader to its modal dialog", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Modal,
        { isOpen: true, onClose: () => undefined },
        createElement(
          ModalHeader,
          { onClose: () => undefined },
          "Repository details",
        ),
      ),
    );
    const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1];

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(titleId).toBeTruthy();
    expect(markup).toContain(`id="${titleId}"`);
    expect(markup).toContain('tabindex="-1"');
  });

  it("exposes Alert as a labelled and described alertdialog", () => {
    const markup = renderToStaticMarkup(
      createElement(Alert, {
        isOpen: true,
        title: "Delete repository?",
        description: "This cannot be undone.",
        primaryButtonText: "Delete",
        secondaryButtonText: "Cancel",
        primaryButtonVariant: "danger",
        onPrimary: () => undefined,
        onSecondary: () => undefined,
      }),
    );
    const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
    const descriptionId = markup.match(/aria-describedby="([^"]+)"/)?.[1];

    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain(`id="${titleId}"`);
    expect(markup).toContain(`id="${descriptionId}"`);
    expect(markup).toContain("glass-danger");
  });

  it("applies a non-danger primary Alert variant", () => {
    const markup = renderToStaticMarkup(
      createElement(Alert, {
        isOpen: true,
        title: "Switch branch?",
        description: "Your changes will move with you.",
        primaryButtonText: "Switch",
        secondaryButtonText: "Cancel",
        primaryButtonVariant: "primary",
        onPrimary: () => undefined,
        onSecondary: () => undefined,
      }),
    );

    expect(markup).toContain("glass-primary");
    expect(markup).not.toContain("glass-danger");
  });
});
