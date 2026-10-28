import { File, FileMode } from "expo-file-system";
import { Image } from "expo-image";
import { Stack, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import type { RunFile } from "@mains/contracts/run-outputs";
import { previewDocument } from "../../../../../modules/mains-document-preview";
import { backendSession, useSession } from "@/backend/backend-session";
import { cachedOutput, cachedAttachment, ensureRunFile, pinOutputFile } from "@/backend/output-cache";
import { Button, ThemedText } from "@/components/ui";
import { isDesktopOnlyOutput } from "@/lib/output-presentation";
import { shareFile } from "@/lib/share-file";
import { useThemeColors, spacing } from "@/theme";
import { Markdown } from "../transcript/markdown";
import { DesktopOutputNotice, outputSize } from "./output-file-card";

type Loaded = { output: RunFile; uri: string; text?: string; truncated?: boolean };

export function OutputDocument({ runId, artifactId }: { runId: string; artifactId: number }) {
  return <RunFileDocument runId={runId} artifactId={artifactId} />;
}

export function AttachmentDocument({ runId, attachmentId }: { runId: string; attachmentId: string }) {
  return <RunFileDocument runId={runId} attachmentId={attachmentId} />;
}

function RunFileDocument({ runId, artifactId, attachmentId }: { runId: string; artifactId?: number; attachmentId?: string }) {
  const colors = useThemeColors();
  const router = useRouter();
  const session = useSession();
  const backendId = session.backend?.backendId ?? "";
  const connected = session.connection.kind === "connected";
  const online = useRef(connected);
  useEffect(() => { online.current = connected; }, [connected]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [desktopOutput, setDesktopOutput] = useState<RunFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const preview = useCallback(async (uri: string, name: string, mimeType?: string) => {
    setPreviewing(true); setError(null);
    try { await previewDocument(uri, name, mimeType); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open preview"); }
    finally { setPreviewing(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let release = () => {};
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setLoaded(null); setDesktopOutput(null); setLoading(true); setError(null); setProgress(0);
      const cached = attachmentId !== undefined ? cachedAttachment(backendId, runId, attachmentId) : cachedOutput(backendId, runId, artifactId!);
      let output = cached?.output;
      if (online.current) output = attachmentId !== undefined ? await backendSession.describeAttachmentFile(runId, attachmentId)
        : (await backendSession.listRunOutputs({ runId, artifactId })).items.find((item) => item.artifactId === artifactId);
      if (controller.signal.aborted) return;
      if (!output) throw new Error(online.current ? "This output is no longer available." : "Connect to your computer to download this file.");
      if (isDesktopOnlyOutput(output)) { setDesktopOutput(output); setLoading(false); return; }
      if (!online.current && !cached?.uri) throw new Error("Connect to your computer to download this file.");
      const selected = output;
      const uri = await ensureRunFile(backendId, selected, (offset) => "attachmentId" in selected
        ? backendSession.readAttachmentChunk({ runId, attachmentId: selected.attachmentId, version: selected.version, offset }, backendId)
        : backendSession.readOutputFile({ runId, artifactId: selected.artifactId, version: selected.version, offset }, backendId), controller.signal, setProgress);
      if (controller.signal.aborted) return;
      release = pinOutputFile(uri);
      const value: Loaded = { output, uri };
      if (output.previewType === "markdown" || output.previewType === "text") {
        const handle = new File(uri).open(FileMode.ReadOnly);
        try { value.text = new TextDecoder().decode(handle.readBytes(Math.min(output.byteSize, 128 * 1024)), { stream: true }); }
        finally { handle.close(); }
        value.truncated = output.byteSize > 128 * 1024;
      }
      setLoaded(value); setLoading(false);
      if (output.previewType === "native") void preview(uri, output.name, output.mimeType);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) { setLoading(false); setError(caught instanceof Error ? caught.message : "Could not load this file"); }
    });
    return () => { controller.abort(); release(); };
  }, [artifactId, attachmentId, attempt, backendId, preview, runId]);
  const share = async () => {
    if (!loaded) return;
    try { await shareFile(loaded.uri, loaded.output.mimeType); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not share this file"); }
  };
  return <View style={{ flex: 1, backgroundColor: colors.systemBackground }}>
    <Stack.Screen options={{ title: loaded?.output.name ?? desktopOutput?.name ?? "File", headerBackVisible: process.env.EXPO_OS !== "ios" }} />
    {process.env.EXPO_OS === "ios" ? <Stack.Toolbar placement="left"><Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Back" onPress={() => router.back()}>Back</Stack.Toolbar.Button></Stack.Toolbar> : null}
    <ScrollView contentInsetAdjustmentBehavior="automatic" minimumZoomScale={1} maximumZoomScale={loaded?.output.previewType === "image" ? 5 : 1}
      contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, gap: spacing.md }}>
      {desktopOutput ? <DesktopOutputNotice name={desktopOutput.name} /> : null}
      {loading ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md }}><ActivityIndicator accessibilityLabel="Downloading file" /><ThemedText variant="footnote">{progress ? `Downloaded ${outputSize(progress)}` : "Loading file…"}</ThemedText></View> : null}
      {loaded?.output.previewType === "image" ? <Image source={{ uri: loaded.uri }} contentFit="contain" style={{ width: "100%", minHeight: 450, flex: 1 }} /> : null}
      {loaded?.output.previewType === "markdown" ? <Markdown source={loaded.text ?? ""} presentation="document" onOpenFile={(filePath) => router.push({ pathname: "/document", params: { runId, filePath } } as Href)} /> : null}
      {loaded?.output.previewType === "text" ? <ThemedText variant="mono" selectable>{loaded.text}</ThemedText> : null}
      {loaded?.truncated ? <ThemedText variant="footnote">Showing the first 128 KB. Share the file to read its full contents.</ThemedText> : null}
      {loaded && ["native", "unsupported"].includes(loaded.output.previewType) ? <View style={{ flex: 1, justifyContent: "center", gap: spacing.md }}>
        <ThemedText variant="title3" style={{ textAlign: "center" }}>{loaded.output.name}</ThemedText>
        <ThemedText variant="subhead" style={{ textAlign: "center" }}>{outputSize(loaded.output.byteSize)} · Available offline</ThemedText>
        {loaded.output.previewType === "native" ? <Button title={process.env.EXPO_OS === "android" ? "Open in app" : "Open preview"} variant="ghost" loading={previewing} onPress={() => void preview(loaded.uri, loaded.output.name, loaded.output.mimeType)} /> : <ThemedText style={{ textAlign: "center" }}>Use Share to open this file in another app.</ThemedText>}
      </View> : null}
      {error ? <ThemedText variant="footnote" style={{ color: colors.systemRed }}>{error}</ThemedText> : null}
      {!loading && !loaded && !desktopOutput ? <Button title="Try again" onPress={() => setAttempt((value) => value + 1)} /> : null}
    </ScrollView>
    {loaded ? <View style={{ padding: spacing.md, paddingBottom: spacing.xl }}><Button title="Share / Save to Files" disabled={previewing} onPress={() => void share()} /></View> : null}
  </View>;
}
