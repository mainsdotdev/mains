import type { RefObject } from "react";
import { Modal, ModalHeader, Text, type TextTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { CliHistorySource, DashboardConsumptionData } from "@mains/contracts/stats";
import { providerDescriptor } from "../lib/dashboard-format";

const SOURCE_STATUS: Record<CliHistorySource["status"], { label: string; tone: TextTone }> = {
  available: { label: "Available", tone: "success" },
  missing: { label: "No history directory", tone: "muted" },
  partial: { label: "Partial scan", tone: "warning" },
  error: { label: "Unreadable", tone: "danger" },
};

const VALUE_EXPLANATIONS = [
  { label: "API estimate", text: "API-equivalent cost, separate from subscription charges." },
  { label: "Cache savings", text: "Cache-read tokens × (input price − cache-read price)." },
  { label: "No data & *", text: "No data: missing usage or prices. *: partial coverage." },
];

export default function CliHistoryInfoModal({ data, isOpen, onClose, returnFocusRef }: {
  data: DashboardConsumptionData;
  isOpen: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const updatedAt = data.pricing.fetchedAt ? new Date(data.pricing.fetchedAt) : null;
  const hasUpdateTime = updatedAt !== null && Number.isFinite(updatedAt.getTime());
  return (
    <Modal isOpen={isOpen} onClose={onClose} returnFocusRef={returnFocusRef}
      placement="center" className="w-full max-w-md max-h-[min(80vh,32rem)] text-primary-900 dark:text-primary-100">
      <ModalHeader onClose={onClose} closeLabel="Close sources & pricing">
        <Text as="h2" size="sm" weight="medium">Sources & pricing</Text>
      </ModalHeader>
      <div className="min-h-0 overflow-y-auto px-4 pb-4 space-y-4">
        <section aria-label="History sources" className="space-y-2">
          <Text as="h3" size="s" weight="medium">History sources</Text>
          {data.sources.length === 0 && <Text size="s" tone="muted">No source information available.</Text>}
          {data.sources.length > 0 && <div className="divide-y divide-primary-200/60 dark:divide-primary/10 rounded-xl bg-primary-100/60 dark:bg-primary/5 px-3">
            {data.sources.map((source) => {
              const provider = providerDescriptor(source.providerId);
              const Icon = provider?.icon;
              const status = SOURCE_STATUS[source.status];
              return (
                <div key={source.providerId} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {Icon && <Icon className={cn("size-4 shrink-0", provider?.accentClassName ?? "text-primary-700 dark:text-primary-300")} aria-hidden="true" />}
                    <Text as="span" size="s" weight="medium">{provider?.label ?? source.providerId}</Text>
                    <Text as="span" size="xs" tone={status.tone}>{status.label}</Text>
                    <Text as="span" size="xs" tone="subtle" className="ml-auto tabular-nums">{source.scannedFiles.toLocaleString()} {source.scannedFiles === 1 ? "file" : "files"} scanned</Text>
                  </div>
                  {source.directories.length > 0 && <div className="mt-2 pl-6 space-y-1">
                    {source.directories.map((directory) => <Text as="code" size="xs" tone="muted" key={directory}
                      className="block font-mono select-text [overflow-wrap:anywhere]">{directory}</Text>)}
                  </div>}
                  {(source.unreadableFiles > 0 || source.skippedLines > 0) && <div className="mt-2 pl-6 flex flex-wrap gap-x-3 gap-y-1">
                    {source.unreadableFiles > 0 && <Text size="xs" tone="warning">{source.unreadableFiles.toLocaleString()} unreadable files or directories</Text>}
                    {source.skippedLines > 0 && <Text size="xs" tone="warning">{source.skippedLines.toLocaleString()} skipped {source.skippedLines === 1 ? "line" : "lines"}</Text>}
                  </div>}
                </div>
              );
            })}
          </div>}
        </section>
        <section aria-label="Pricing" className="border-t border-primary-200/60 dark:border-primary/10 pt-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <Text as="h3" size="s" weight="medium">Pricing</Text>
            <Text size="xs" tone={data.pricing.status === "unavailable" ? "warning" : data.pricing.status === "fresh" ? "success" : "muted"}>
              {data.pricing.status === "unavailable" ? "Unavailable" : data.pricing.status === "cached" ? "Cached prices" : "Up to date"}
            </Text>
          </div>
          {data.pricing.status === "unavailable" ? <Text size="s" tone="muted">Token history is still included. Unpriced estimates show No data.</Text>
            : <div>
              <Text size="s" title={data.pricing.source}>LiteLLM base model prices</Text>
              <Text size="xs" tone="subtle" className="mt-0.5">{hasUpdateTime
                ? <>Updated <time dateTime={data.pricing.fetchedAt!}>{updatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</time></>
                : "Update time unavailable"}</Text>
            </div>}
          <dl className="space-y-2.5 pt-1">
            {VALUE_EXPLANATIONS.map((item) => <div key={item.label} className="grid grid-cols-[6rem_1fr] gap-3">
              <Text as="dt" size="s" weight="medium">{item.label}</Text>
              <Text as="dd" size="s" tone="muted" className="leading-5">{item.text}</Text>
            </div>)}
          </dl>
        </section>
      </div>
    </Modal>
  );
}
