// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import appSettingsReducer, {
  setBrowserPanelOpen,
  setRightPanelOpen,
  setSessionPanelOpen,
  type DocumentViewerDoc,
} from "@/lib/redux/slices/appSettingsSlice";
import { DocumentViewerProvider, useDocumentViewer } from "./use-document-viewer";

afterEach(cleanup);

describe("Atlas document viewer", () => {
  it.each(["pdf", "xlsx", "docx"] as const)("opens %s in the preview lane without workspace tools", (docType) => {
    const store = configureStore({ reducer: { appSettings: appSettingsReducer } });
    store.dispatch(setRightPanelOpen(true));
    store.dispatch(setSessionPanelOpen(true));
    store.dispatch(setBrowserPanelOpen(true));
    let panel: ReturnType<typeof useDocumentViewer>;
    function Consumer() {
      panel = useDocumentViewer();
      return null;
    }
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/atlas?type=docs"]}>
          <DocumentViewerProvider><Consumer /></DocumentViewerProvider>
        </MemoryRouter>
      </Provider>,
    );
    const doc: DocumentViewerDoc = {
      path: `/tmp/report.${docType}`,
      fileName: `report.${docType}`,
      docType,
    };

    act(() => panel.open(doc));

    expect(panel!.isOpen).toBe(true);
    expect(panel!.currentDoc).toEqual(doc);
    const settings = store.getState().appSettings;
    expect(settings.rightPanelOpen).toBe(false);
    expect(settings.sessionPanelOpen).toBe(false);
    expect(settings.browserPanelOpen).toBe(false);
  });
});
