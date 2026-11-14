import { useEffect, useLayoutEffect, useState } from "react";
import { useGetAccountQuery } from "@/lib/redux/api";
import { useAppSelector } from "@/lib/redux/hooks";
import { onTransportChange } from "@/lib/transport";
import { useKeyboardShortcut } from "@/providers/keyboard-shortcuts-provider";
import { OPEN_ATLAS_BOOKMARK_EVENT, type AtlasBookmarkRequest } from "../lib/bookmark-modal-bridge";
import { AtlasBookmarkEditor } from "./atlas-bookmark-editor";

/** One creation dialog shared by the app shortcut and Atlas library buttons. */
export function AtlasBookmarkModal() {
  const { currentData: account } = useGetAccountQuery();
  const backendId = useAppSelector((state) => state.backends.activeBackendId);
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  useLayoutEffect(() => onTransportChange(() => setConnectionGeneration((generation) => generation + 1)), []);

  return account ? <BookmarkModalHost
    key={JSON.stringify([backendId, account.id, connectionGeneration])}
    accountId={account.id}
  /> : null;
}

function BookmarkModalHost({ accountId }: { accountId: string }) {
  const [draft, setDraft] = useState<AtlasBookmarkRequest | null>(null);

  useKeyboardShortcut("app.saveBookmark", () => {
    setDraft((current) => current ?? { accountId });
  }, { allowInEditable: true });

  useEffect(() => {
    const open = (event: Event) => {
      const request = (event as CustomEvent<AtlasBookmarkRequest>).detail;
      if (request.accountId === accountId) setDraft((current) => current ?? request);
    };
    window.addEventListener(OPEN_ATLAS_BOOKMARK_EVENT, open);
    return () => window.removeEventListener(OPEN_ATLAS_BOOKMARK_EVENT, open);
  }, [accountId]);

  return draft ? <AtlasBookmarkEditor
    accountId={accountId}
    collectionId={draft.collectionId}
    onClose={() => setDraft(null)}
  /> : null;
}
