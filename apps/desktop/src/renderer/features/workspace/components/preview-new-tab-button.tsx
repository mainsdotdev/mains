import { Button, toast } from "@/components/ui";
import { Close, Plus } from "@/components/ui/icons";
import { useBrowserPanel } from "@/hooks/use-browser-panel";
import { useCapabilities } from "@/lib/platform";
import { usePreviewPanel } from "@/hooks/use-preview-panel";

/** The tab action creates pages; the fixed toggle switches between open and hide. */
export function PreviewNewTabButton({ togglePanel = false }: { togglePanel?: boolean }) {
  const browser = useBrowserPanel();
  const preview = usePreviewPanel();
  const { embeddedBrowser } = useCapabilities();
  const closing = togglePanel && preview.isOpen;
  const label = closing ? "Close preview" : "New browser tab";
  return (
    <Button variant="icon" tooltip={label} tooltipPosition="bottom"
      aria-label={label} disabled={!closing && !embeddedBrowser}
      aria-expanded={togglePanel ? preview.isOpen : undefined}
      aria-controls={togglePanel ? "preview-panel" : undefined}
      onClick={() => {
        if (closing) {
          preview.hide();
          return;
        }
        void browser.newTab().catch((error) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
      }}>
      {closing ? <Close className="size-4" /> : <Plus className="size-4" />}
    </Button>
  );
}
