import { useState } from "react";
import type { AtlasPage } from "@mains/contracts/atlas";
import { Button, Modal, Muted, Text, toast } from "@/components/ui";
import { useAtlasRevisionQuery, useResolveAtlasConflictMutation } from "@/lib/redux/api/atlasApi";
import { atlasError } from "../hooks/use-save-to-atlas";

export function AtlasPageConflicts({ page, beforeResolve, onResolved }: {
  page: AtlasPage;
  beforeResolve: () => Promise<number | null>;
  onResolved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const otherId = page.conflicts?.find((row) => row.id === selected)?.id ?? page.conflicts?.[0]?.id ?? "";
  const other = useAtlasRevisionQuery({ accountId: page.item.accountId, id: page.item.id, revisionId: otherId }, { skip: !open || !otherId });
  const [resolve, resolving] = useResolveAtlasConflictMutation();
  const choose = async (choice: "current" | "other") => {
    try {
      const version = await beforeResolve();
      if (version === null) return;
      await resolve({ accountId: page.item.accountId, id: page.item.id, revisionId: otherId, expectedVersion: version, choice }).unwrap();
      await onResolved(); setOpen(false);
    } catch (error) { toast.error(atlasError(error)); }
  };
  return <>
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-primary-200 p-4 dark:border-primary-800">
      <Text size="sm">Edited on two devices at the same time.</Text>
      <Button variant="ghost" onClick={() => setOpen(true)}>View the other version</Button>
    </div>
    <Modal isOpen={open} onClose={() => setOpen(false)} aria-label="Choose a version" className="max-w-3xl">
      <div className="space-y-4 p-5">
        <Text>Choose a version</Text>
        <Muted>Both versions stay in history after you choose.</Muted>
        {page.conflicts?.map((row) => <Button key={row.id} variant={row.id === otherId ? "primary" : "ghost"}
          onClick={() => setSelected(row.id)}>{row.title} · {row.backendLabel ?? row.backendId ?? "This device"} · {new Date(row.createdAt).toLocaleString()}</Button>)}
        {other.error != null && <Text role="alert">{atlasError(other.error)}</Text>}
        {other.isFetching && <Muted>Opening version…</Muted>}
        {other.data?.id === otherId && <div className="max-h-80 overflow-y-auto rounded-xl border border-primary-200 p-4 dark:border-primary-800">
          <Text>{other.data.title}</Text>
          <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm">{other.data.markdown}</pre>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={resolving.isLoading || !otherId} onClick={() => void choose("current")}>Keep current version</Button>
          <Button variant="ghost" disabled={resolving.isLoading || other.data?.id !== otherId || other.isFetching} onClick={() => void choose("other")}>Use the other version</Button>
        </div>
      </div>
    </Modal>
  </>;
}
