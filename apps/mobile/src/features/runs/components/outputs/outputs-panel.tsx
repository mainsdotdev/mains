import { and, eq } from "drizzle-orm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { RunOutput } from "@mains/contracts/run-outputs";
import { backendSession, useSession } from "@/backend/backend-session";
import { cachedOutput } from "@/backend/output-cache";
import { Button, SheetScrollView, ThemedText } from "@/components/ui";
import { db } from "@/db/client";
import { runOutputs, runs } from "@/db/schema";
import { useCoalescedLiveQuery } from "@/db/use-coalesced-live-query";
import { isDesktopOnlyOutput } from "@/lib/output-presentation";
import { useThemeColors, spacing } from "@/theme";
import { OutputFileCard } from "./output-file-card";

export function OutputsPanel({ runId }: { runId: string }) {
  const colors = useThemeColors();
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const connected = session.connection.kind === "connected";
  const cached = useCoalescedLiveQuery(db.select().from(runOutputs).where(and(eq(runOutputs.backendId, backendId), eq(runOutputs.runId, runId))), runOutputs, [backendId, runId]);
  const run = useCoalescedLiveQuery(db.select({ status: runs.status }).from(runs).where(and(eq(runs.backendId, backendId), eq(runs.id, runId))).limit(1), runs, [backendId, runId]);
  const [items, setItems] = useState<RunOutput[] | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async (offset = 0) => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    try {
      const page = await backendSession.listRunOutputs({ runId, offset });
      if (request !== generation.current) return;
      setItems((current) => offset === 0 ? page.items : [...new Map([...(current ?? []), ...page.items].map((item) => [item.artifactId, item])).values()]);
      setLoadedScope(JSON.stringify([backendId, runId]));
      setNextOffset(page.nextOffset);
    } catch (caught) { if (request === generation.current) setError(caught instanceof Error ? caught.message : "Could not load outputs"); }
    finally { if (request === generation.current) setLoading(false); }
  }, [backendId, runId]);
  // Outputs are selected when a turn completes, so a status change is when the
  // list can differ. The run row's every other update (a streaming turn bumps
  // it per event) would re-list and re-stat every file on the Mac.
  const status = run.data[0]?.status;
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (connected) void load(); else setLoading(false);
    });
    return () => { active = false; invalidate(); };
  }, [backendId, connected, invalidate, load, status]);
  const saved = useMemo(
    () => cached.data.flatMap((row) => { try { return [JSON.parse(row.descriptorJson) as RunOutput]; } catch { return []; } }),
    [cached.data],
  );
  // Checking a local copy touches the filesystem; do it when the cache rows change, not per render.
  const offline = useMemo(
    () => new Set(cached.data.filter((row) => cachedOutput(backendId, runId, row.artifactId)?.uri).map((row) => row.artifactId)),
    [backendId, cached.data, runId],
  );
  const currentScope = loadedScope === JSON.stringify([backendId, runId]);
  const shown = connected && currentScope && items !== null ? items : saved;
  return <SheetScrollView>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <ThemedText variant="subhead">Files delivered in this conversation</ThemedText>
      <Button title="Refresh" size="sm" variant="ghost" disabled={!connected || loading} onPress={() => void load()} />
    </View>
    {!connected ? <ThemedText variant="footnote">Previously downloaded files open offline. Connect to your computer to download other files.</ThemedText> : null}
    {shown.map((output) => <OutputFileCard key={output.artifactId} runId={runId} artifactId={output.artifactId} name={output.name} byteSize={output.byteSize} desktopOnly={isDesktopOnlyOutput(output)} saved={!isDesktopOnlyOutput(output) && offline.has(output.artifactId)} />)}
    {!shown.length && !loading ? <ThemedText variant="subhead" style={{ paddingVertical: spacing.xl, textAlign: "center" }}>{error ? "Outputs are unavailable." : "No output files yet."}</ThemedText> : null}
    {error ? <ThemedText variant="footnote" style={{ color: colors.systemRed }}>{error}</ThemedText> : null}
    {loading ? <ActivityIndicator accessibilityLabel="Loading outputs" /> : null}
    {connected && currentScope && nextOffset !== null ? <Button title="Load more files" variant="secondary" disabled={loading} onPress={() => void load(nextOffset)} /> : null}
  </SheetScrollView>;
}
