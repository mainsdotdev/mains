import { and, eq } from "drizzle-orm";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import type { RunOutput } from "@mains/contracts/run-outputs";
import { backendSession, useSession } from "@/backend/backend-session";
import { cachedOutput } from "@/backend/output-cache";
import { Button, ThemedText } from "@/components/ui";
import { db } from "@/db/client";
import { runOutputs, runs } from "@/db/schema";
import { useCoalescedLiveQuery } from "@/db/use-coalesced-live-query";
import { isDesktopOnlyOutput } from "@/lib/output-presentation";
import { colors, spacing } from "@/theme";
import { OutputFileCard } from "./output-file-card";

export function OutputsPanel({ runId }: { runId: string }) {
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const connected = session.connection.kind === "connected";
  const cached = useCoalescedLiveQuery(db.select().from(runOutputs).where(and(eq(runOutputs.backendId, backendId), eq(runOutputs.runId, runId))), runOutputs, [backendId, runId]);
  const run = useCoalescedLiveQuery(db.select({ updatedAt: runs.updatedAt }).from(runs).where(and(eq(runs.backendId, backendId), eq(runs.id, runId))).limit(1), runs, [backendId, runId]);
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
  const updated = run.data[0]?.updatedAt?.getTime();
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (connected) void load(); else setLoading(false);
    });
    return () => { active = false; invalidate(); };
  }, [backendId, connected, invalidate, load, updated]);
  const saved = cached.data.flatMap((row) => { try { return [JSON.parse(row.descriptorJson) as RunOutput]; } catch { return []; } });
  const currentScope = loadedScope === JSON.stringify([backendId, runId]);
  const shown = connected && currentScope && items !== null ? items : saved;
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <ThemedText variant="subhead">Files delivered in this conversation</ThemedText>
      <Button title="Refresh" size="sm" variant="ghost" disabled={!connected || loading} onPress={() => void load()} />
    </View>
    {!connected ? <ThemedText variant="footnote">Previously downloaded files open offline. Connect to your computer to download other files.</ThemedText> : null}
    {shown.map((output) => <OutputFileCard key={output.artifactId} runId={runId} artifactId={output.artifactId} name={output.name} byteSize={output.byteSize} desktopOnly={isDesktopOnlyOutput(output)} saved={!isDesktopOnlyOutput(output) && !!cachedOutput(backendId, runId, output.artifactId)?.uri} />)}
    {!shown.length && !loading ? <ThemedText variant="subhead" style={{ paddingVertical: spacing.xl, textAlign: "center" }}>{error ? "Outputs are unavailable." : "No output files yet."}</ThemedText> : null}
    {error ? <ThemedText variant="footnote" style={{ color: colors.systemRed }}>{error}</ThemedText> : null}
    {loading ? <ActivityIndicator accessibilityLabel="Loading outputs" /> : null}
    {connected && currentScope && nextOffset !== null ? <Button title="Load more files" variant="secondary" disabled={loading} onPress={() => void load(nextOffset)} /> : null}
  </ScrollView>;
}
