import { Close } from "@/components/ui/icons";
import { Body, Button, SegmentedTabs } from "@/components/ui";

type Tab = "schemas" | "editor";

interface SchemaModalHeaderProps {
  titleId: string;
  activeTab: Tab;
  editingId: string | null;
  onTabChange: (tab: Tab) => void;
  onClose: () => void;
}

export function SchemaModalHeader({
  titleId,
  activeTab,
  editingId,
  onTabChange,
  onClose,
}: SchemaModalHeaderProps) {
  return (
    <div className="flex items-center justify-between p-6">
      <div className="flex items-center gap-4">
        <Body as="h2" id={titleId}>
          Structured outputs
        </Body>
        <SegmentedTabs
          id="structured-outputs-tabs"
          value={activeTab}
          onChange={onTabChange}
          options={[
            { value: "schemas", label: "Schemas" },
            { value: "editor", label: editingId ? "Edit" : "New" },
          ]}
          panelId="structured-outputs-panel"
          aria-label="Structured output view"
          className="min-w-37"
        />
      </div>
      <Button
        onClick={onClose}
        aria-label="Close modal"
        className="absolute top-4 right-4  glass-button flex items-center justify-center rounded-full cursor-pointer hover:bg-primary-100/80 dark:hover:bg-primary/10 p-1.5 text-primary-900 dark:text-primary-100 transition-all duration-300 ease-out"
      >
        <Close className="size-4" />
      </Button>
    </div>
  );
}
