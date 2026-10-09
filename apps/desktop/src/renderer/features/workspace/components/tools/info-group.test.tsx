// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserAnnotation } from "@mains/contracts/browser-annotations";
import { groupEvents, type EventGroup } from "../../lib/group-events";
import { mapArtifactToEvent } from "../../lib/run-event-mappers";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
});

vi.mock("../prompt-markdown", () => ({
  PromptMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
  promptMessageMentionsFile: () => false,
}));
vi.mock("@/hooks/use-local-image-url", () => ({
  useLocalImageUrl: (src: string | undefined) => src?.startsWith("/") ? `mains-localimg://signed?path=${encodeURIComponent(src)}` : src,
}));
vi.mock("../../lib/attachment-image", () => ({
  useAttachmentImage: (_runId?: string, attachmentId?: string, maxSide = 256) => ({
    observe: () => {}, src: attachmentId ? `blob:${attachmentId}:${maxSide}` : undefined,
  }),
}));
vi.mock("../image-preview-modal", () => ({
  ImagePreviewModal: ({ name, src }: { name: string; src: string }) => <div role="dialog" aria-label={name}>{src}</div>,
}));
vi.mock("@/hooks/use-document-viewer", () => ({ useDocumentViewer: () => ({ openDocument: vi.fn() }) }));
vi.mock("@/lib/redux/api", () => ({ useLazyGetAppsForFileQuery: () => [vi.fn(), {}] }));
vi.mock("@/hooks/use-suppress-browser-view", () => ({ useSuppressBrowserView: vi.fn() }));
import { useSuppressBrowserView } from "@/hooks/use-suppress-browser-view";
import { InfoGroup } from "./info-group";

const annotations: BrowserAnnotation[] = [
  { id: "one", url: "https://mains.dev", comment: "Bunları güncelle", elements: [
    { tagName: "section", selector: "#intro", text: "Introduction" },
    { tagName: "a", selector: "#link", text: "Workspaces" },
  ] },
  { id: "two", url: "https://docs.mains.dev", comment: "İkinci yorum", elements: [{ tagName: "div", selector: "#card", text: "Quickstart" }] },
];
function prompt(metadata: Record<string, unknown> = {}): EventGroup {
  return { id: "prompt", type: "info", startTime: new Date(), endTime: new Date(), events: [{
    id: "message", type: "artifact", content: "deneme", timestamp: new Date(),
    metadata: { kind: "user-prompt", browserAnnotations: annotations, attachments: [
      { name: "annotation-one.png", type: "image", mimeType: "image/png", captureName: "annotation-one.png" },
      { name: "annotation-two.png", type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,eA==" },
    ], ...metadata },
  }] };
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("assistant image previews", () => {
  it("shows each screenshot once when the final answer embeds two Markdown images", () => {
    const content = "İki çizgili ikon artık tıklayınca animasyonla çarpıya dönüşüyor. Menü de 300 ms’lik yumuşak bir hareketle aşağı açılıyor.\n\nMobil ve klavye kontrolleri, lint ve TypeScript geçti.\n\n![Kapalı menü ikonu](/private/tmp/header-menu-closed.jpg)\n![Açık menü ve çarpı ikonu](/private/tmp/header-menu-open.jpg)";
    const group = groupEvents([mapArtifactToEvent({ id: 487, runId: "run", kind: "report", content,
      metadata: { source: "agent_message", messagePhase: "final_answer" } })])[0];

    render(<InfoGroup group={group} />);

    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Kapalı menü ikonu" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Açık menü ve çarpı ikonu" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview Kapalı menü ikonu" }));
    expect(screen.getByRole("dialog", { name: "Kapalı menü ikonu" }).textContent)
      .toBe("mains-localimg://signed?path=%2Fprivate%2Ftmp%2Fheader-menu-closed.jpg");
  });

  it("shows only the reference-style Markdown image and leaves a plain path as text", () => {
    const content = "![Menu][screenshot]\n\n[screenshot]: /tmp/menu.jpg\n\nOther screenshot: `/tmp/other.jpg`";
    const group = groupEvents([mapArtifactToEvent({ id: 1, runId: "run", kind: "report", content })])[0];
    render(<InfoGroup group={group} />);

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Menu" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "other.jpg" })).toBeNull();
    expect(screen.getByText("/tmp/other.jpg").tagName).toBe("CODE");
  });
});

describe("streaming assistant equations", () => {
  it("keeps incomplete math hidden in a persisted interrupted report", () => {
    const event = mapArtifactToEvent({ id: 1, runId: "run", kind: "report",
      content: "Received text\n" + String.raw`\[\frac{1}{`,
      metadata: { interrupted: true, streaming: false, streamId: "stopped-report" } });
    const group = groupEvents([event])[0];
    const view = render(<InfoGroup group={group} />);
    expect(view.container.textContent).toContain("Received text");
    expect(view.container.querySelector(".katex-error")).toBeNull();
  });
  it("retains the visible prefix when a long stopped answer replaces its live preview", async () => {
    const content = "Received answer ".repeat(100);
    const live = { id: "stream-stopped", type: "artifact" as const, timestamp: new Date(), content,
      metadata: { kind: "report", streamId: "stopped", streaming: true } };
    const liveGroup = groupEvents([live])[0];
    const view = render(<InfoGroup key={liveGroup.id} group={liveGroup} />);
    await waitFor(() => expect(view.container.textContent?.length).toBeGreaterThan(content.length - 180));
    // A reveal frame can have queued a state update that is not on screen yet;
    // the next rerender would commit it and the prefix would look like it
    // grew. Commit it first, then snapshot and replace with no frame between.
    view.rerender(<InfoGroup key={liveGroup.id} group={liveGroup} />);
    const visible = view.container.textContent ?? "";
    expect(visible.length).toBeLessThan(content.length);
    const stoppedGroup = groupEvents([{ ...live, metadata: { ...live.metadata, streaming: false, interrupted: true } }])[0];
    view.rerender(<InfoGroup key={stoppedGroup.id} group={stoppedGroup} />);
    expect(view.container.textContent).toBe(visible);
    const savedGroup = groupEvents([mapArtifactToEvent({ id: 42, runId: "run", kind: "report", content,
      metadata: { streamId: "stopped", streaming: false, interrupted: true } })])[0];
    view.rerender(<InfoGroup key={savedGroup.id} group={savedGroup} />);
    expect(view.container.textContent).toBe(visible);
    await waitFor(() => expect(view.container.textContent).toBe(content.trimEnd()), { timeout: 4000 });
  });

  it("waits for the equation while the report streams and while its final buffer drains", async () => {
    const group: EventGroup = {
      id: "response-stream-native-report", type: "response", startTime: new Date(), endTime: new Date(),
      events: [{
        id: "stream-native-report", type: "artifact", timestamp: new Date(),
        content: String.raw`Energy decreases:\[\frac{d}{dt}\left(\frac12\int |u|^`,
        metadata: { kind: "report", streamId: "native-report", streaming: true },
      }],
    };
    const view = render(<InfoGroup key={group.id} group={group} />);

    await waitFor(() => expect(view.container.textContent).toContain("Energy decreases:"));
    expect(view.container.querySelector(".katex-error")).toBeNull();
    expect(view.container.querySelector(".katex-display")).toBeNull();

    const beforePersistence = view.container.textContent;
    const persisted = mapArtifactToEvent({
      id: 42, runId: "run", kind: "report", createdAt: new Date(),
      content: group.events[0].content + String.raw`2\right)=-\nu\int |\nabla u|^2\]`,
      metadata: { streamId: "native-report" },
    });
    const settledGroup = groupEvents([persisted])[0];
    view.rerender(<InfoGroup key={settledGroup.id} group={settledGroup} />);

    expect(view.container.textContent).toBe(beforePersistence);
    expect(view.container.querySelector(".katex-error")).toBeNull();
    await waitFor(() => expect(view.container.querySelector(".katex-display")).not.toBeNull(), { timeout: 4000 });
    expect(view.container.querySelector(".katex-error")).toBeNull();
  });
});

describe("prompt browser annotations", () => {
  it("opens the bounded expanded preview from a compact attachment reference", () => {
    render(<InfoGroup runId="run" group={prompt({ attachments: [{ name: "screen.png", type: "image", attachmentId: "image-id", mimeType: "image/png", byteSize: 100 }] })} />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("blob:image-id:256");
    fireEvent.click(screen.getByRole("button", { name: "Preview screen.png" }));
    expect(screen.getByRole("dialog", { name: "screen.png" }).textContent).toBe("blob:image-id:1600");
  });
  it("shows screenshots, one annotation chip and the message, with read-only grouped details", async () => {
    render(<InfoGroup group={prompt()} />);
    const chip = screen.getByRole("button", { name: "2 annotations" });
    expect(screen.getAllByRole("img")).toHaveLength(2);
    const image = screen.getAllByRole("img")[1];
    expect(image.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chip.compareDocumentPosition(screen.getByText("deneme")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(chip);
    await screen.findByRole("dialog", { name: "Browser annotations" });
    for (const text of ["section", "div", "Introduction", "Workspaces", "Quickstart", "Bunları güncelle", "İkinci yorum"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /Edit annotation|Delete annotation/ })).toBeNull();
    expect(useSuppressBrowserView).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Browser annotations" })).toBeNull();
    expect(document.activeElement).toBe(chip);
    fireEvent.click(chip);
    await screen.findByRole("dialog");
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps each historical prompt independent of the current composer and other turns", async () => {
    render(<><InfoGroup group={prompt({ browserAnnotations: [annotations[0]] })} /><InfoGroup group={prompt({ browserAnnotations: [annotations[1]] })} /></>);
    const chips = screen.getAllByRole("button", { name: "1 annotation" });
    fireEvent.click(chips[1]);
    await screen.findByText("İkinci yorum");
    expect(screen.queryByText("Bunları güncelle")).toBeNull();
  });

  it("previews the durable image copy after the transient capture has expired", () => {
    render(<InfoGroup group={prompt({ attachments: [{ name: "annotation.png", type: "image", mimeType: "image/png", path: "/uploads/run/annotation.png", captureName: "expired.png" }] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview annotation.png" }));
    expect(screen.getByRole("dialog", { name: "annotation.png" }).textContent).toBe("mains-localimg://signed?path=%2Fuploads%2Frun%2Fannotation.png");
  });

  it("leaves older prompts and ordinary screenshots without an annotation chip", () => {
    render(<InfoGroup group={prompt({ browserAnnotations: undefined })} />);
    expect(screen.queryByRole("button", { name: /annotation(s)?$/ })).toBeNull();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("deneme")).toBeTruthy();
  });
});
