import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch } from "@/lib/redux/hooks";
import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { File, EditProvider } from "@pierre/diffs/react";
import type { EditorFactory, FileContents } from "@pierre/diffs/react";
import { Editor, type EditorOptions } from "@pierre/diffs/edit";
import {
  setSelectedFileContent,
  addContextItem,
} from "@/lib/redux/slices/workspaceSlice";
import { useResyncWorkspaceDiffMutation } from "@/lib/redux/api";
import { DIFF_TYPOGRAPHY_STYLE, diffSurfaceOptions } from "@/lib/diff-style";
import { useDiffHighlighterReady } from "@/lib/diff-highlighter";
import { Button, Text } from "@/components/ui";
import type {
  FileContentResponse,
  ServiceResponse,
  WriteFileTextResponse,
} from "@/features/workspace/types/file-explorer";

const AUTOSAVE_DELAY_MS = 750;
// Must match the optimistic-concurrency error thrown by fileExplorerService.
const CONFLICT_ERROR = "File changed on disk";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

// Not exported by @pierre/diffs — extracted from the option's signature.
type SelectionActionCtx = Parameters<
  NonNullable<EditorOptions<"file", undefined, undefined>["renderSelectionAction"]>
>[0];

interface CodeViewerProps {
  content: string;
  filename?: string;
  className?: string;
  /** Absolute path on disk. Editing is only enabled when provided. */
  filePath?: string;
  /** Disk mtime of `content` — baseline for conflict-guarded auto-saves. */
  mtimeMs?: number;
  /** When set, each successful save resyncs this workspace's diff snapshot. */
  workspaceId?: string;
}

export function CodeViewer({
  content,
  filename,
  className = "",
  filePath,
  mtimeMs,
  workspaceId,
}: CodeViewerProps) {
  const isDarkMode = useIsDarkMode();
  const dispatch = useAppDispatch();
  const [resyncWorkspaceDiff] = useResyncWorkspaceDiffMutation();
  // Same cold-start blank as the diff viewer: `File` paints nothing while the
  // highlighter is still loading and never repaints on its own.
  const highlighterReady = useDiffHighlighterReady();

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // Bumped only when reloading from disk after a conflict: a fresh cacheKey
  // resets the editor's cached document (and undo history) to the reloaded
  // contents. Regular auto-saves keep the key stable so history survives.
  const [editSession, setEditSession] = useState(0);

  const draftRef = useRef<string | null>(null);
  const lastSavedRef = useRef(content);
  const baselineMtimeRef = useRef(mtimeMs);
  // Set after a failed save; blocks further auto-saves until the user picks
  // Reload / Overwrite / Retry so we don't hammer a failing write.
  const pausedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saves are sequenced through this promise chain; each save reads the
  // latest draft when it runs, so a slow write can never clobber a newer one.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  // The editor caches its working document by cacheKey and substitutes the
  // cached text on re-render — this is what keeps the live buffer (and the
  // Redux content refresh after each save) from resetting the edit session.
  const file: FileContents = useMemo(
    () => ({
      name: filename ?? "file",
      contents: content,
      cacheKey: `${filePath ?? filename ?? "file"}:${editSession}`,
    }),
    [filename, content, filePath, editSession],
  );

  const runSave = useCallback(
    async (force = false) => {
      if (!filePath) return;
      const contents = draftRef.current;
      if (contents == null || (!force && contents === lastSavedRef.current)) {
        setSaveState((s) => (s === "dirty" ? "saved" : s));
        return;
      }
      if (!force && pausedRef.current) return;
      setSaveState("saving");
      try {
        const result: ServiceResponse<WriteFileTextResponse> =
          await window.api.fileExplorer.writeFileText({
            filePath,
            content: contents,
            expectedMtimeMs: force ? undefined : baselineMtimeRef.current,
          });
        if (result.success && result.data) {
          lastSavedRef.current = contents;
          baselineMtimeRef.current = result.data.mtimeMs;
          dispatch(
            setSelectedFileContent({
              content: contents,
              size: result.data.size,
              isBinary: false,
              encoding: "utf-8",
              mtimeMs: result.data.mtimeMs,
            }),
          );
          setConflict(false);
          setSaveError(null);
          setSaveState(draftRef.current === contents ? "saved" : "dirty");
          // Keep the git side in step: recapture the workspace diff snapshot
          // so the Changes tab, counts, and +/- stats reflect the edit.
          if (workspaceId) resyncWorkspaceDiff(workspaceId);
        } else {
          const message = result.success ? "Failed to save file" : result.error;
          pausedRef.current = true;
          setConflict(message === CONFLICT_ERROR);
          setSaveError(message);
          setSaveState("error");
        }
      } catch (err) {
        pausedRef.current = true;
        setConflict(false);
        setSaveError(err instanceof Error ? err.message : "Failed to save file");
        setSaveState("error");
      }
    },
    [filePath, dispatch, workspaceId, resyncWorkspaceDiff],
  );

  const enqueueSave = useCallback(
    (force = false) => {
      chainRef.current = chainRef.current.then(() => runSave(force));
      return chainRef.current;
    },
    [runSave],
  );

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return enqueueSave();
  }, [enqueueSave]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Flush pending edits when the window loses focus or the surface unmounts
  // (switching files remounts this component via its key).
  useEffect(() => {
    const onBlur = () => void flushRef.current();
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      void flushRef.current();
    };
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void enqueueSave();
    }, AUTOSAVE_DELAY_MS);
  }, [enqueueSave]);

  const createEditor = useCallback<EditorFactory<undefined, undefined>>(
    (editorType, surfaceOptions, editStateKey) =>
      new Editor(
        editorType,
        {
          clipboard: { readText: () => navigator.clipboard.readText() },
          ...surfaceOptions,
        },
        editStateKey,
      ),
    [],
  );

  // The live selection-action context while the widget is visible — lets the
  // ⌘L shortcut reuse the same action as clicking the button.
  const selectionActionRef = useRef<SelectionActionCtx | null>(null);

  // Without a path the selection has no resolvable reference — the agent would
  // receive `@file#L3` and a "Code selection from file" header naming nothing.
  // So the action is gated on `filePath`, same as editing.
  const addSelectionToChat = useCallback(
    (ctx: SelectionActionCtx) => {
      if (!filePath) {
        ctx.close();
        return;
      }
      const text = ctx.getSelectionText();
      if (text.trim().length > 0) {
        const { start, end } = ctx.selection;
        // A drag past a line's end lands on character 0 of the next line —
        // that trailing line holds none of the selection, so drop it.
        const endLine =
          end.character === 0 && end.line > start.line ? end.line - 1 : end.line;
        dispatch(
          addContextItem({
            kind: "code",
            id: crypto.randomUUID(),
            filePath,
            fileName: filename ?? filePath.split("/").pop() ?? filePath,
            startLine: start.line + 1,
            endLine: endLine + 1,
            text,
          }),
        );
      }
      selectionActionRef.current = null;
      ctx.close();
    },
    [dispatch, filePath, filename],
  );

  const editorOptions = useMemo<EditorOptions<"file", undefined, undefined>>(
    () => ({
      onChange: (edited) => {
        draftRef.current = edited.file.contents;
        if (pausedRef.current) return;
        setSaveState("dirty");
        schedule();
      },
      enabledSelectionAction: !!filePath,
      // The widget mounts inside the editor's shadow DOM, so Tailwind classes
      // don't reach it — styles must be inline. The library's popover wrapper
      // already draws the chrome (border, bg, shadow), so the button itself is
      // chromeless content and inherits the widget's themed foreground.
      renderSelectionAction: (ctx) => {
        selectionActionRef.current = ctx;
        const button = document.createElement("button");
        button.type = "button";
        Object.assign(button.style, {
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "2px 4px",
          border: "0",
          background: "transparent",
          color: "var(--diffs-widget-fg, inherit)",
          font: "500 11px ui-sans-serif, system-ui, sans-serif",
          cursor: "pointer",
          whiteSpace: "nowrap",
        } satisfies Partial<CSSStyleDeclaration>);

        const label = document.createElement("span");
        label.textContent = "Add to Chat";
        button.appendChild(label);

        const kbd = document.createElement("span");
        kbd.textContent = "⌘L";
        Object.assign(kbd.style, {
          padding: "3px 5px",
          borderRadius: "6px",
          background: "color-mix(in lab, currentColor 12%, transparent)",
          color: "color-mix(in lab, currentColor 65%, transparent)",
          font: "500 11px ui-sans-serif, system-ui, sans-serif",
          lineHeight: "1",
        } satisfies Partial<CSSStyleDeclaration>);
        button.appendChild(kbd);

        button.onclick = () => addSelectionToChat(ctx);
        return button;
      },
    }),
    [schedule, addSelectionToChat, filePath],
  );

  const handleReload = useCallback(async () => {
    if (!filePath) return;
    const result: ServiceResponse<FileContentResponse> =
      await window.api.fileExplorer.readFileText({ filePath });
    if (result.success && result.data && !result.data.isBinary) {
      draftRef.current = null;
      lastSavedRef.current = result.data.content;
      baselineMtimeRef.current = result.data.mtimeMs;
      pausedRef.current = false;
      setConflict(false);
      setSaveError(null);
      setSaveState("idle");
      dispatch(setSelectedFileContent(result.data));
      setEditSession((s) => s + 1);
    } else {
      setSaveError(result.success ? "Failed to reload file" : result.error);
    }
  }, [filePath, dispatch]);

  const handleOverwrite = useCallback(() => {
    pausedRef.current = false;
    setConflict(false);
    setSaveError(null);
    void enqueueSave(true);
  }, [enqueueSave]);

  const handleRetry = useCallback(() => {
    pausedRef.current = false;
    setSaveError(null);
    setSaveState("dirty");
    void enqueueSave();
  }, [enqueueSave]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void flush();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
        const ctx = selectionActionRef.current;
        if (ctx) {
          event.preventDefault();
          addSelectionToChat(ctx);
        }
      }
    },
    [flush, addSelectionToChat],
  );

  return (
    <div className={`relative h-full ${className}`} onKeyDown={handleKeyDown}>
      {filePath && saveState !== "idle" && (
        <div className="absolute top-1 right-2 z-10 flex items-center gap-1.5 rounded-lg px-2 py-1 bg-primary/20 dark:bg-primary-950/50 backdrop-blur-sm">
          {saveState === "error" ? (
            <>
              <Text
                as="span"
                size="xs"
                tone="danger"
                className="max-w-100 truncate"
                title={saveError ?? undefined}
              >
                {saveError}
              </Text>
              {conflict ? (
                <>
                  <Button
                    variant="primary"
                    onClick={() => void handleReload()}
                    className="px-2 py-1 text-xs!"
                  >
                    Reload
                  </Button>
                  <Button
                    variant="danger"
                    onClick={handleOverwrite}
                    className="px-2 py-1 text-xs!"
                  >
                    Overwrite
                  </Button>
                </>
              ) : (
                <Button
                  variant="submit"
                  onClick={handleRetry}
                  className="px-2 py-1 text-xs!"
                >
                  Retry
                </Button>
              )}
            </>
          )  : null}
        </div>
      )}
      <div className="h-full overflow-auto">
        {!highlighterReady ? (
          <Text as="div" size="xs" tone="subtle" className="px-4 py-3 shine-text">
            Loading file...
          </Text>
        ) : (
        <EditProvider createEditor={createEditor}>
          <File
            file={file}
            edit={!!filePath}
            editorOptions={editorOptions}
            style={DIFF_TYPOGRAPHY_STYLE}
            options={{ ...diffSurfaceOptions(isDarkMode), overflow: "scroll" }}
          />
        </EditProvider>
        )}
      </div>
    </div>
  );
}
