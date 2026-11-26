import { useId, useState } from "react";
import type { BridgeStorageOverview } from "@mains/contracts/bridge";
import { Button, Modal, ModalHeader, Muted, Text } from "@/components/ui";
import { appApi } from "@/lib/transport";

type StorageItem = BridgeStorageOverview["items"][number];
const reclaimable = (item: StorageItem) => item.recordBytes + item.reclaimableBlobBytes;

export function storageSize(bytes: number) {
  const [divisor, unit] = bytes >= 1024 ** 3 ? [1024 ** 3, "GiB"] :
    bytes > 0 && bytes < 1024 ** 2 ? [1024, "KiB"] : [1024 ** 2, "MiB"];
  return `${(bytes / divisor).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

export function BridgeStorage({ retainedBytes = 0 }: { retainedBytes?: number }) {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState<BridgeStorageOverview | null>(null);
  const [selected, setSelected] = useState<StorageItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useId();
  async function load() {
    const result = await appApi.bridge.storageOverview();
    if (!result.success) throw new Error(result.error);
    setOverview(result.data);
  }
  async function update(item?: StorageItem) {
    setBusy(true);
    setError(null);
    try {
      if (item) {
        const result = await appApi.bridge.deleteStorageRun(item.id);
        if (!result.success) throw new Error(result.error);
        setSelected(null);
        setOverview(previous => previous && { ...previous, items: previous.items.filter(row => row.kind !== "run" || row.id !== item.id) });
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bridge storage is unavailable");
    } finally { setBusy(false); }
  }
  function close() {
    if (busy) return;
    setOpen(false);
    setOverview(null);
    setSelected(null);
    setError(null);
  }
  return (
    <>
      <Button variant="secondary" onClick={() => { setOpen(true); void update(); }}>Manage storage</Button>
      <Modal isOpen={open} onClose={close} aria-labelledby={heading} closeOnEscape={!busy} closeOnBackdrop={!busy} className="max-h-[min(35rem,75dvh)] w-full max-w-3xl">
        <ModalHeader onClose={close}>
          <Text as="h2" id={heading} size="base" weight="medium">{selected ? "Delete synced conversation?" : "Manage Bridge storage"}</Text>
        </ModalHeader>
        {selected ? (
          <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-6 pb-5 pt-2 wrap-anywhere">
            {error && <Text role="alert" tone="danger">{error}</Text>}
            <Text as="p"><strong>{selected.title}</strong> will be permanently deleted from Bridge and removed from syncing devices.</Text>
            <Muted as="p">Estimated space freed is {storageSize(reclaimable(selected))}. Shared files stay available, and Bridge keeps a small deletion record.</Muted>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => { setSelected(null); setError(null); }}>Cancel</Button>
              <Button variant="danger" disabled={busy} onClick={() => void update(selected)}>{busy ? "Deleting…" : "Delete conversation"}</Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3 px-6 pb-5">
            <div className="shrink-0 space-y-2">
              <div className="flex items-start justify-between gap-3 sm:items-center">
                <Muted size="s">Largest synced items. Shared files count toward space freed when their last reference is removed.</Muted>
                <Button
                  variant="secondary"
                  className="shrink-0"
                  isLoading={busy}
                  aria-label={busy ? "Checking storage…" : undefined}
                  onClick={() => void update()}
                >
                  Refresh
                </Button>
              </div>
              {error && <Text role="alert" tone="danger" className="wrap-anywhere">{error}</Text>}
              {retainedBytes > 0 && <Muted size="s">{storageSize(retainedBytes)} awaiting physical cleanup</Muted>}
              {overview?.items.length === 0 && <Muted>There are no synced conversations or large files yet.</Muted>}
            </div>
            {!!overview?.items.length && (
              <div
                role="region"
                aria-label="Synced items"
                tabIndex={0}
                className="min-h-0 overflow-auto overscroll-contain rounded-lg scroll-pt-9 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              >
                <Text as="table" size="s" className="w-full border-separate border-spacing-0 text-left">
                  <Muted as="thead" size="xs" className="sticky top-0 z-10 bg-primary-200 dark:bg-primary-800">
                    <tr className="whitespace-nowrap *:px-2.5 *:py-2 *:font-medium">
                      <th scope="col">Item</th>
                      <th scope="col" className="text-right">Synced size</th>
                      <th scope="col" className="text-right">Est. space freed</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </Muted>
                  <tbody>
                    {overview.items.map(item => (
                      <tr key={`${item.kind}:${item.id}`} className="align-middle *:border-b *:border-primary-500/15 *:px-2.5 *:py-1.5">
                        <th scope="row" className="min-w-32 wrap-anywhere font-normal">
                          <div>{item.title}</div>
                          <Muted as="span" size="xs">{item.kind === "account" ? "Account file" : [item.ownerLabel, item.ownerRetired && "Removed device"].filter(Boolean).join(" · ") || "Conversation"}</Muted>
                        </th>
                        <td className="whitespace-nowrap text-right tabular-nums">{storageSize(item.recordBytes + item.blobBytes)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{storageSize(reclaimable(item))}</td>
                        <td className="text-right">
                          {item.canDelete && <Button variant="ghost" disabled={busy} aria-label={`Delete ${item.title}`} onClick={() => setSelected(item)}>Delete</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Text>
              </div>
            )}
            {overview?.hasMore && <Muted size="xs" className="shrink-0">Showing the 100 largest items.</Muted>}
          </div>
        )}
      </Modal>
    </>
  );
}
