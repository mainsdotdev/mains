import { useRef, useState, type ReactNode } from "react";
import { Button, DropdownWrapper, Text } from "@/components/ui";
import { ArrowUp, Check, Close, Plus } from "@/components/ui/icons";
import { useClickOutside } from "@/hooks/use-click-outside";

export interface MobileTab {
  /** Matches `activeTab` (run id, "editor", "issue:<id>", "note:<id>", …). */
  id: string;
  label: string;
  icon: ReactNode;
  group: "Editor" | "Issues" | "Signals" | "Notes" | "Runs";
  onSelect: () => void;
  onClose?: (e: React.MouseEvent) => void;
}

const GROUP_ORDER: MobileTab["group"][] = [
  "Editor",
  "Issues",
  "Signals",
  "Notes",
  "Runs",
];

/**
 * Mobile replacement for the horizontal tab strip: a single "active tab" button
 * that opens a grouped list of all open tabs to switch between (plus New run).
 * A scrolling tab strip is unintuitive on a phone; this collapses it to one
 * control. Desktop keeps the strip (see WorkspaceTabs).
 */
export function MobileTabSwitcher({
  tabs,
  activeTab,
  onNewRun,
}: {
  tabs: MobileTab[];
  activeTab: string;
  onNewRun: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  useClickOutside(containerRef, () => setIsOpen(false));

  const active = tabs.find((t) => t.id === activeTab);

  return (
    // ml-2 clears the fixed sidebar hamburger (top-left) on mobile.
    <div className="relative ml-2" ref={containerRef}>
      <Button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="inline-flex max-w-[50vw] items-center gap-2 px-2.5 py-2 rounded-xl text-s cursor-pointer text-primary-950 dark:text-primary hover:bg-primary/10 transition-colors"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <span className="shrink-0 flex items-center">{active?.icon}</span>
        <span className="flex-1 truncate text-left">
          {active?.label ?? "Tabs"}
        </span>
        {tabs.length > 1 && (
          <Text as="span" size="xxs" tone="subtle" className="shrink-0 rounded-full bg-primary-200/60 px-1.5 py-0.5 dark:bg-primary-800/60">
            {tabs.length}
          </Text>
        )}
        <ArrowUp className="size-3.5 shrink-0 rotate-180" />
      </Button>

      <DropdownWrapper
        isOpen={isOpen}
        aria-label="Open tabs"
        openUpward={false}
        minWidth="min-w-64"
      >
        <div className="max-h-[60vh] overflow-auto noscrollbar py-1">
          {GROUP_ORDER.map((group) => {
            const items = tabs.filter((t) => t.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <Text as="div" size="xxs" tone="subtle" className="px-2.5 pt-2.5 pb-1 uppercase tracking-wide">
                  {group}
                </Text>
                {items.map((t) => {
                  const isActive = t.id === activeTab;
                  return (
                    <div
                      key={t.id}
                      className={`flex items-center transition-colors ${
                        isActive
                          ? "bg-primary-200/60 dark:bg-primary-200/10 text-primary-950 dark:text-primary"
                          : "hover:bg-primary-200/30 dark:hover:bg-primary-800 text-primary-700 dark:text-primary-300"
                      }`}
                    >
                      <Button
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        onClick={() => {
                          t.onSelect();
                          setIsOpen(false);
                        }}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-2 text-sm"
                      >
                        <span className="flex shrink-0 items-center">
                          {t.icon}
                        </span>
                        <span className="flex-1 truncate text-left">{t.label}</span>
                        {isActive && <Check className="size-3.5 shrink-0" />}
                      </Button>
                      {t.onClose && (
                        <Button
                          type="button"
                          role="menuitem"
                          aria-label="Close tab"
                          onClick={(e) => {
                            t.onClose!(e);
                          }}
                          className="mr-2 shrink-0 rounded p-0.5 hover:bg-primary-300/40 dark:hover:bg-primary-700/40"
                        >
                          <Close className="size-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div className="mt-1 border-t border-primary-200/60 pt-1 dark:border-primary-800/30">
            <Button
              type="button"
              role="menuitem"
              onClick={() => {
                onNewRun();
                setIsOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-sm cursor-pointer text-primary-700 hover:bg-primary-200/30 dark:text-primary-300 dark:hover:bg-primary-800"
            >
              <Plus className="size-4 shrink-0" />
              <span className="flex-1 text-left">New run</span>
            </Button>
          </div>
        </div>
      </DropdownWrapper>
    </div>
  );
}
