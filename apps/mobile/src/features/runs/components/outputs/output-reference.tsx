import { and, eq } from "drizzle-orm";
import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { RunOutput } from "@mains/contracts/run-outputs";
import { backendSession, useSession } from "@/backend/backend-session";
import { Button, ThemedText } from "@/components/ui";
import { db } from "@/db/client";
import { runOutputs } from "@/db/schema";
import { outputReferenceName } from "@/lib/output-reference";
import { isDesktopOnlyOutput } from "@/lib/output-presentation";
import { spacing } from "@/theme";
import { MarkdownDocument } from "../document/markdown-document";
import { DesktopOutputNotice } from "./output-file-card";

export function OutputReference({ runId, filePath }: { runId: string; filePath: string }) {
  const router = useRouter();
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const connected = session.connection.kind === "connected";
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = outputReferenceName(filePath);
  const desktopName = name && isDesktopOnlyOutput({ name }) ? name : null;
  useEffect(() => {
    if (desktopName) return;
    let active = true;
    let allowMarkdownFallback = true;
    void (async () => {
      const name = outputReferenceName(filePath);
      if (!name) throw new Error("This file cannot be opened here.");
      let outputs: RunOutput[] = [];
      if (connected) {
        let offset: number | null = 0;
        for (let page = 0; offset !== null && page < 50; page++) {
          const result = await backendSession.listRunOutputs({ runId, offset });
          if (!active) return;
          outputs.push(...result.items.filter((item) => item.name === name));
          offset = result.nextOffset;
        }
      } else {
        outputs = db.select().from(runOutputs).where(and(eq(runOutputs.backendId, backendId), eq(runOutputs.runId, runId))).all()
          .flatMap((row) => { try { return [JSON.parse(row.descriptorJson) as RunOutput]; } catch { return []; } }).filter((item) => item.name === name);
      }
      if (!active) return;
      allowMarkdownFallback = outputs.length === 0;
      if (outputs.length === 1) router.replace({ pathname: "/output/[artifactId]", params: { runId, artifactId: String(outputs[0].artifactId) } } as Href);
      else if (!outputs.length && /\.(md|markdown)$/i.test(name)) setFallback(true);
      else throw new Error(outputs.length > 1 ? "Several outputs have this name. Choose the file from Outputs." : "This file is not available in this conversation’s outputs.");
    })().catch((caught: unknown) => {
      if (!active) return;
      if (allowMarkdownFallback && /\.(md|markdown)(?:[#:]|$)/i.test(filePath)) setFallback(true);
      else setError(caught instanceof Error ? caught.message : "Could not open this file");
    });
    return () => { active = false; };
  }, [backendId, connected, desktopName, filePath, router, runId]);
  if (desktopName) return <View style={{ padding: spacing.lg }}><DesktopOutputNotice name={desktopName} /></View>;
  if (fallback) return <MarkdownDocument runId={runId} filePath={filePath} />;
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg }}>
    {error ? <><ThemedText>{error}</ThemedText><Button title="Show outputs" onPress={() => router.replace({ pathname: "/outputs", params: { runId } } as Href)} /></> : <ActivityIndicator accessibilityLabel="Finding output" />}
  </View>;
}
