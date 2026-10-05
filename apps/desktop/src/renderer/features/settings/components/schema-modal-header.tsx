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
        variant="icon" iconSize="sm"
        onClick={onClose}
        aria-label="Close modal"
        className="absolute top-4 right-4"
      >
        <Close className="size-4" />
      </Button>
    </div>
  );
}
