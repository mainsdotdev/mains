import { useState } from "react";
import type { ContextBrowserSelection } from "@/features/workspace/lib/composer-context";
import { useComposerContext } from "@/features/workspace/hooks/use-composer-context";
import { Close, Web } from "@/components/ui/icons";
import { ProviderIcon } from "./provider-icon";
import { Body, Button, Modal, ModalHeader, Text } from "@/components/ui";

function hostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}



function BrowserSelectionPreview({
  sel,
  onClose,
}: {
  sel: ContextBrowserSelection;
  onClose: () => void;
}) {
  const surroundImg = sel.surroundingScreenshotCaptureName
    ? `mains-capture://cap/${sel.surroundingScreenshotCaptureName}`
    : undefined;
  const elementImg = sel.screenshotCaptureName
    ? `mains-capture://cap/${sel.screenshotCaptureName}`
    : undefined;
  const summary = sel.componentName || `${sel.tagName}${sel.selector ? ` · ${sel.selector.split(" > ").slice(-1)[0]}` : ""}`;

  return (
    <Modal
      isOpen
      onClose={onClose}
      backdrop="media"
      className="max-w-lg w-full bg-primary-50 dark:bg-primary-950"
    >
      <ModalHeader onClose={onClose}>
        <Web className="w-3.5 h-3.5 shrink-0 text-primary-800 dark:text-primary-200" />
        <div className="min-w-0">
          <Body size="xs">
            {summary}
          </Body>
          <Body size="xs" className="opacity-60">
            {hostname(sel.url)}
          </Body>
        </div>
      </ModalHeader>

      {/* Screenshot */}
      {surroundImg ? (
        <div className="relative bg-primary-100 dark:bg-primary-950">
          <img
            src={surroundImg}
            alt="Surrounding context"
            className="w-full max-h-72 object-contain"
          />
          {elementImg && (
            <div className="absolute bottom-2 right-2 rounded-md overflow-hidden border-2 border-accent shadow-lg">
              <img
                src={elementImg}
                alt="Selected element"
                className="max-w-32 max-h-20 object-contain bg-primary"
              />
            </div>
          )}
        </div>
      ) : elementImg ? (
        <div className="bg-primary-100 dark:bg-primary-900">
          <img
            src={elementImg}
            alt="Selected element"
            className="w-full max-h-72 object-contain"
          />
        </div>
      ) : (
        <Text
          as="div"
          size="xs"
          tone="subtle"
          className="flex items-center justify-center h-32 bg-primary-100 dark:bg-primary-900"
        >
          No screenshot available
        </Text>
      )}

      {/* Metadata */}
      {(sel.text || sel.sourceFile) && (
        <div className="px-4 py-2.5 border-t border-primary-200 dark:border-primary-800 space-y-1">
          {sel.sourceFile && (
            <Body size="xs">
              {sel.sourceFile}
            </Body>
          )}
          {sel.text && (
            <Body size="xs">
              {sel.text}
            </Body>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * The chip row above the composer. Reads its own context rather than taking it
 * as props: it renders exactly what is attached, so threading four lists and
 * three removers through the input only gave them a chance to disagree.
 *
 * Skills and code selections are absent by design — those render as inline
 * chips inside the prompt itself.
 */
export function ContextChips() {
  const { issues, signals, browserSelections, remove } = useComposerContext();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewSel = browserSelections.find((s) => s.id === previewId) ?? null;

  // Only what this row actually draws may open it. Skills are context too, but
  // they appear as chips *inside* the input (`skillChipMap` on RichInputForm),
  // so counting them here opened an empty padded band above the composer.
  const hasContext =
    issues.length > 0 || signals.length > 0 || browserSelections.length > 0;

  return (
    <>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${hasContext ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
            {issues.map((issue) => (
              <div
                key={issue.entityId}
                className={`flex items-center glass-button gap-1.5 px-2 py-1.5 rounded-full text-xs  dark:text-primary-300 text-primary-700`}
              >
                <ProviderIcon provider={issue.provider} className="size-4" fallback="text" />
                <span className="truncate max-w-37.5">{issue.title}</span>
                <Button
                  onClick={() => remove(issue)}
                  className=" flex items-center glass-button justify-center rounded-full p-0.5  transition-colors"
                  title="Remove from context"
                >
                  <Close className="size-3" />
                </Button>
              </div>
            ))}

            {signals.map((signal) => (
              <div
                key={signal.entityId}
                className={`flex items-center glass-button gap-1.5 px-2 py-1.5 rounded-full text-xs dark:text-primary-300 text-primary-700`}
              >
                <ProviderIcon provider={signal.source} className="w-3 h-3" fallback="text" />
                <span className="truncate max-w-37.5">{signal.title}</span>
                <Button
                  onClick={() => remove(signal)}
                  className="w-4 h-4 flex items-center justify-center glass-button rounded-full p-0.5 transition-colors"
                  title="Remove from context"
                >
                  <Close className="size-3" />
                </Button>
              </div>
            ))}
            {browserSelections.map((sel) => {
              const thumbName =
                sel.screenshotCaptureName || sel.surroundingScreenshotCaptureName;
              const thumb = thumbName ? `mains-capture://cap/${thumbName}` : undefined;
              const summary =
                sel.componentName ||
                sel.tagName +
                  (sel.selector ? ` · ${sel.selector.split(" > ").slice(-1)[0]}` : "");
              return (
                <div
                  key={sel.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPreviewId(sel.id)}
                  onKeyDown={(e) => e.key === "Enter" && setPreviewId(sel.id)}
                  className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full glass-button text-xs bg-primary dark:bg-primary-300/10 dark:text-primary-300 text-primary-700 cursor-pointer"
                  title={`Click to preview · ${sel.title || sel.url} — ${sel.selector}`}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      className="size-4 rounded-md object-cover"
                    />
                  ) : (
                    <Web className="size-3" />
                  )}
                  <span className="truncate max-w-44">
                    <Text as="span" size="inherit" tone="inherit" weight="medium">{summary}</Text>
                    <span className="opacity-60"> · {hostname(sel.url)}</span>
                  </span>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(sel);
                    }}
                    className=" flex items-center justify-center glass-button rounded-full p-0.5 hover:bg-primary/20 dark:hover:bg-primary/10 transition-colors"
                    title="Remove from context"
                  >
                    <Close className="size-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {previewSel && (
        <BrowserSelectionPreview sel={previewSel} onClose={() => setPreviewId(null)} />
      )}
    </>
  );
}
