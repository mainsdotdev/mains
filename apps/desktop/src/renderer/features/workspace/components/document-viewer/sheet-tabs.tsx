import { Button } from "@/components/ui";

/** Bottom tab bar for multi-sheet XLSX workbooks. Light DOM (lives outside the
 * render host's shadow root) so it picks up the app's Tailwind styles. */
export function SheetTabs({
  sheetNames,
  active,
  onSelect,
}: {
  sheetNames: string[];
  active: string | null;
  onSelect: (name: string) => void;
}) {
  if (sheetNames.length <= 1) return null;
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-t border-primary-200/60 dark:border-primary-800/50 bg-primary dark:bg-primary-950 px-2 py-1">
      {sheetNames.map((name) => (
        <Button
          key={name}
          onClick={() => onSelect(name)}
          className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
            active === name
              ? "bg-primary-200/70 dark:bg-primary-800/60 text-primary-900 dark:text-primary-100"
              : "text-primary-600 dark:text-primary-400 hover:bg-primary-200/40 dark:hover:bg-primary-800/40"
          }`}
          title={name}
        >
          {name}
        </Button>
      ))}
    </div>
  );
}
