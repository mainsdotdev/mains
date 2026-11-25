import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Text } from "@/components/ui";
import type { DocumentViewerDoc } from "@/lib/redux/slices/appSettingsSlice";
import { isPassThroughDocSrc, localDocumentUrlRevision, signLocalDocument, subscribeLocalDocumentUrls } from "@/lib/local-document-url";
import { DocumentFallback } from "./document-fallback";
import { DOC_TYPE_ICONS } from "./doc-type-icons";

export function MediaDocument({ doc, active }: { doc: DocumentViewerDoc; active: boolean }) {
  const revision = useSyncExternalStore(subscribeLocalDocumentUrls, localDocumentUrlRevision);
  return <MediaPlayer key={JSON.stringify([revision, doc.path])} doc={doc} active={active} />;
}

function MediaPlayer({ doc, active }: { doc: DocumentViewerDoc; active: boolean }) {
  const { path, fileName, docType } = doc;
  const [src, setSrc] = useState<string | null>();
  const [failed, setFailed] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!active || src !== undefined) return;
    let cancelled = false;
    const source = isPassThroughDocSrc(path) ? Promise.resolve(path) : signLocalDocument(path);
    void source.then((url) => { if (!cancelled) setSrc(url); });
    return () => { cancelled = true; };
  }, [active, path, src]);

  useEffect(() => {
    const player = audio.current ?? video.current;
    return () => { player?.pause(); };
  }, [active, src]);

  if (src === null || failed) {
    return <div className="relative flex-1">
      <DocumentFallback doc={doc} message="This file couldn’t be played. Save a copy or open it in another app." />
    </div>;
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      {!src ? <Text size="sm" tone="muted" role="status">Opening media…</Text> : docType === "video" ? (
        <video ref={video} src={src} controls playsInline preload="metadata" aria-label={fileName}
          className="max-h-full w-full max-w-5xl rounded-xl bg-black object-contain" onError={() => setFailed(true)} />
      ) : (
        <div className="glass-card w-full max-w-lg rounded-2xl p-3">
          <div className="mb-3 flex items-center gap-3 px-1">
            <DOC_TYPE_ICONS.audio className="size-8 shrink-0" aria-hidden="true" />
            <Text as="div" size="sm" weight="medium" className="truncate" title={fileName}>{fileName}</Text>
          </div>
          <audio ref={audio} src={src} controls preload="metadata" aria-label={fileName}
            className="block w-full dark:scheme-dark" onError={() => setFailed(true)} />
        </div>
      )}
    </div>
  );
}
