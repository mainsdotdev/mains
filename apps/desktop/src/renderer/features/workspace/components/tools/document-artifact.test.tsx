// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentArtifact } from "./document-artifact";
import { documentPreviewLimit } from "@mains/contracts/output-files";

const open = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-document-viewer", () => ({ useDocumentViewer: () => ({ open }) }));
vi.mock("@/features/atlas/hooks/use-save-to-atlas", () => ({ useSaveToAtlas: () => ({ save: vi.fn(), saving: false }) }));
vi.mock("@/lib/redux/api", () => ({ useLazyGetAppsForFileQuery: () => [vi.fn(), { data: [], isFetching: false }] }));
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ revealInFolder: true }) }));
afterEach(() => { cleanup(); open.mockClear(); });

describe("document artifact preview limits", () => {
  it.each(["pptx", "docx", "pdf", "md"] as const)("keeps an oversized %s downloadable and forwards its size to the viewer", (docType) => {
    const byteSize = documentPreviewLimit(docType) + 1;
    render(<DocumentArtifact absPath={`/tmp/report.${docType}`} fileName={`report.${docType}`} docType={docType} byteSize={byteSize} />);
    expect(screen.getByText(/Too large for inline preview/)).toBeTruthy();
    fireEvent.click(screen.getByText(`report.${docType}`));
    expect(open).toHaveBeenCalledWith({ path: `/tmp/report.${docType}`, fileName: `report.${docType}`, docType, byteSize });
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  });
});
