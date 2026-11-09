import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Caption, Input, Text, toast } from "@/components/ui";
import { Edit, Search, Trash, Undo } from "@/components/ui/icons";
import { useKeyboardShortcuts } from "@/providers/keyboard-shortcuts-provider";
import {
  formatKeyboardShortcut,
  KEYBOARD_SHORTCUTS,
  resolveKeyboardShortcut,
  type KeyboardShortcutCategory,
  type KeyboardShortcutDefinition,
  type KeyboardShortcutId,
} from "../../../../shared/keyboard-shortcuts";
import {
  SettingsDivider,
  SettingsPageShell,
  SettingsSection,
} from "./settings-layout";

import { createShortcutRecorder, idleShortcutRecorder } from "../../../../shared/capture-shortcut-lifecycle";

const CATEGORY_ORDER: readonly KeyboardShortcutCategory[] = [
  "General",
  "Navigation",
  "Projects",
  "Browser",
  "Editor",
];

function ShortcutKeys({ binding }: { binding: string | null }) {
  const keys = formatKeyboardShortcut(binding);
  if (keys.length === 0) {
    return (
      <Text as="span" size="xs" tone="faint" className="whitespace-nowrap">
        Unassigned
      </Text>
    );
  }
  return (
    <span className="flex items-center gap-1" aria-label={binding ?? undefined}>
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="flex min-w-6 items-center justify-center rounded-lg glass-input  px-2 py-1 text-[15px] font-medium leading-none text-primary-950   dark:text-primary-50"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

function ShortcutRow({
  shortcut,
  binding,
  customized,
  recording,
  busy,
  error,
  onStartRecording,
  onRecord,
  onCancel,
  onClear,
  onReset,
}: {
  shortcut: KeyboardShortcutDefinition;
  binding: string | null;
  customized: boolean;
  recording: boolean;
  busy: boolean;
  error: string | null;
  onStartRecording: () => void;
  onRecord: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onCancel: () => void;
  onClear: () => void;
  onReset: () => void;
}) {
  return (
    <div className="group flex min-h-17 flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 md:flex-1 md:pr-8">
        <div className="flex items-center gap-2">
          <Text as="span" size="s" weight="medium">
            {shortcut.title}
          </Text>
          {customized && (
            <span className="size-1.5 rounded-full bg-accent" aria-label="Customized" />
          )}
        </div>
        <Caption className="mt-0.5">{shortcut.description}</Caption>
        {error && recording && (
          <Text as="p" size="xs" tone="danger" className="mt-1.5" role="alert">
            {error}
          </Text>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:justify-end">
        {recording ? (
          <>
            <button
              type="button"
              data-shortcut-recorder="true"
              autoFocus
              disabled={busy}
              onKeyDown={onRecord}
              className="flex min-h-9 min-w-42 items-center justify-center rounded-xl border border-primary-950 /10 bg-primary-950/10 px-3 text-s font-medium text-primary-950 outline-none ring-2 ring-primary-950/5 dark:text-primary-50 dark:bg-primary-50/10 dark:border-primary-50/10 dark:ring-primary-50/5"
            >
              Press shortcut
            </button>
            <Button variant="ghost" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onStartRecording}
              className="flex min-h-9 min-w-28 items-center justify-center rounded-xl px-2.5 text-primary-700 transition-colors hover:bg-primary/55 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 dark:text-primary-300 dark:hover:bg-primary/5"
              aria-label={`Change ${shortcut.title} shortcut`}
            >
              <ShortcutKeys binding={binding} />
            </button>
            <Button
              variant="icon"
              tooltip={`Edit ${shortcut.title}`}
              aria-label={`Edit ${shortcut.title}`}
              disabled={busy}
              onClick={onStartRecording}
            >
              <Edit className="size-3.5" />
            </Button>
            {binding && (
              <Button
                variant="icon"
                tooltip={`Unassign ${shortcut.title}`}
                aria-label={`Unassign ${shortcut.title}`}
                disabled={busy}
                onClick={onClear}
              >
                <Trash className="size-3.5" />
              </Button>
            )}
            {customized && (
              <Button
                variant="icon"
                tooltip={`Reset ${shortcut.title}`}
                aria-label={`Reset ${shortcut.title}`}
                disabled={busy}
                onClick={onReset}
              >
                <Undo className="size-3.5" />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function KeyboardShortcutsSettings() {
  const { bindings, overrides, isLoading, error, update, resetAll } =
    useKeyboardShortcuts();
  const [query, setQuery] = useState("");
  const [recorderState, setRecorderState] = useState(idleShortcutRecorder);
  const recorder = useRef<ReturnType<typeof createShortcutRecorder> | null>(null);
  const overridesRef = useRef(overrides);
  useLayoutEffect(() => { overridesRef.current = overrides; }, [overrides]);
  useLayoutEffect(() => {
    const owner = createShortcutRecorder({ update, resetAll, overrides: () => overridesRef.current,
      change: setRecorderState, error: (message) => toast.error(message), reset: () => toast.success("Keyboard shortcuts reset") });
    recorder.current = owner;
    return () => { owner.close(); if (recorder.current === owner) recorder.current = null; };
  }, [update, resetAll]);
  const recordingId = recorderState.recordingId;
  const recordingError = recorderState.error;
  const busy = recorderState.phase === "saving";

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return KEYBOARD_SHORTCUTS;
    return KEYBOARD_SHORTCUTS.filter((shortcut) =>
      `${shortcut.title} ${shortcut.description} ${shortcut.category}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [query]);

  const commit = (id: KeyboardShortcutId, binding: string | null) => recorder.current?.commit(id, binding);
  const handleRecord = (id: KeyboardShortcutId, event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault(); event.stopPropagation();
    recorder.current?.record(id, event.nativeEvent);
  };

  const hasOverrides = Object.keys(overrides).length > 0;
  const headerActions = hasOverrides ? (
    <Button
      variant="ghost"
      disabled={busy}
      onClick={() => { void recorder.current?.resetAll(); }}
    >
      Reset all
    </Button>
  ) : undefined;

  return (
    <SettingsPageShell
      title="Keyboard Shortcuts"
      isLoading={isLoading}
      error={error}
      errorMessage={error ?? undefined}
      headerActions={headerActions}
      className="pb-16"
    >
      <div className="relative mb-6">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-primary-500"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search shortcuts"
          aria-label="Search keyboard shortcuts"
          className="h-11 rounded-2xl pl-10"
        />
      </div>

      {CATEGORY_ORDER.map((category) => {
        const shortcuts = visible.filter(
          (shortcut) => shortcut.category === category,
        );
        if (shortcuts.length === 0) return null;
        return (
          <SettingsSection key={category} title={category}>
            {shortcuts.map((shortcut, index) => (
              <div key={shortcut.id}>
                {index > 0 && <SettingsDivider />}
                <ShortcutRow
                  shortcut={shortcut}
                  binding={bindings[shortcut.id]}
                  customized={Object.prototype.hasOwnProperty.call(
                    overrides,
                    shortcut.id,
                  )}
                  recording={recordingId === shortcut.id}
                  busy={busy}
                  error={recordingError}
                  onStartRecording={() => {
                    recorder.current?.start(shortcut.id);
                  }}
                  onRecord={(event) => handleRecord(shortcut.id, event)}
                  onCancel={() => {
                    recorder.current?.cancel();
                  }}
                  onClear={() => void commit(shortcut.id, null)}
                  onReset={() => void commit(shortcut.id, resolveKeyboardShortcut(shortcut.id, {}))}
                />
              </div>
            ))}
          </SettingsSection>
        );
      })}

      {visible.length === 0 && (
        <div className="rounded-3xl glass-surface px-5 py-10 text-center">
          <Text size="sm" tone="muted">
            No shortcuts match “{query.trim()}”.
          </Text>
        </div>
      )}
    </SettingsPageShell>
  );
}
