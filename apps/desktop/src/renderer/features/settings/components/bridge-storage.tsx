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
      <Modal isOpen={open} onClose={close} aria-labelledby={heading} closeOnEscape={!busy} closeOnBackdrop={!busy} className="w-full max-w-3xl">
        <ModalHeader onClose={close}>
          <Text as="h2" id={heading} size="base" weight="medium">{selected ? "Delete synced conversation?" : "Manage Bridge storage"}</Text>
        </ModalHeader>
        <div className="space-y-3 overflow-y-auto px-6 pb-5 pt-2">
          {error && <Text role="alert" tone="danger">{error}</Text>}
          {selected ? (
            <>
              <Text as="p"><strong>{selected.title}</strong> will be permanently deleted from Bridge and removed from syncing devices.</Text>
              <Muted as="p">Estimated space freed is {storageSize(reclaimable(selected))}. Shared files stay available, and Bridge keeps a small deletion record.</Muted>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => { setSelected(null); setError(null); }}>Cancel</Button>
                <Button variant="danger" disabled={busy} onClick={() => void update(selected)}>{busy ? "Deleting…" : "Delete conversation"}</Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Muted as="p">Largest synced items. Shared files count toward space freed when their last reference is removed.</Muted>
                <Button variant="secondary" disabled={busy} onClick={() => void update()}>Refresh</Button>
              </div>
              {retainedBytes > 0 && <Muted as="p">{storageSize(retainedBytes)} awaiting physical cleanup</Muted>}
              {busy && <Muted role="status">Checking storage…</Muted>}
              {overview?.items.length === 0 && <Muted>There are no synced conversations or large files yet.</Muted>}
              {!!overview?.items.length && <div className="overflow-x-auto">
                <Text as="table" size="sm" className="w-full border-collapse text-left">
                  <thead><tr className="border-b border-primary-500/20">
                    <th scope="col" className="p-2 font-medium">Item</th>
                    <th scope="col" className="p-2 text-right font-medium">Synced size</th>
                    <th scope="col" className="p-2 text-right font-medium">Est. space freed</th>
                    <th scope="col" className="p-2"><span className="sr-only">Actions</span></th>
                  </tr></thead>
                  <tbody>{overview.items.map(item => (
                    <tr key={`${item.kind}:${item.id}`} className="border-b border-primary-500/10 align-middle">
                      <td className="max-w-xs break-words p-2">
                        <div>{item.title}</div>
                        <Muted as="span" size="xs">{item.kind === "account" ? "Account file" : [item.ownerLabel, item.ownerRetired && "Removed device"].filter(Boolean).join(" · ") || "Conversation"}</Muted>
                      </td>
                      <td className="whitespace-nowrap p-2 text-right tabular-nums">{storageSize(item.recordBytes + item.blobBytes)}</td>
                      <td className="whitespace-nowrap p-2 text-right tabular-nums">{storageSize(reclaimable(item))}</td>
                      <td className="p-2 text-right">
                        {item.canDelete && <Button variant="secondary" disabled={busy} aria-label={`Delete ${item.title}`} onClick={() => setSelected(item)}>Delete</Button>}
                      </td>
                    </tr>
                  ))}</tbody>
                </Text>
              </div>}
              {overview?.hasMore && <Muted>Showing the 100 largest items.</Muted>}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
