import { useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { backendSession } from "@/backend/backend-session";
import { ThemedText } from "@/components/ui";
import { colors, spacing } from "@/theme";
import type { RunTextFile } from "@mains/contracts/runs";

import { Markdown } from "../transcript/markdown";

type LoadedDocument =
  | { status: "loading" }
  | { status: "ready"; document: RunTextFile }
  | { status: "failed"; reason: string };

/**
 * One run-local Markdown file on a native screen. The body stays on the Mac
 * until this view opens; only the guarded text response crosses the socket.
 */
export function MarkdownDocument({
  runId,
  filePath,
}: {
  runId: string;
  filePath: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<LoadedDocument>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    backendSession.readRunTextFile(runId, filePath).then(
      (document) => {
        if (!cancelled) setState({ status: "ready", document });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: "failed",
            reason: error instanceof Error ? error.message : "Could not load this document",
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [filePath, runId]);

  const openLinkedFile = useCallback(
    (linkedPath: string) => {
      const currentPath = state.status === "ready" ? state.document.relativePath : filePath;
      const slash = currentPath.lastIndexOf("/");
      const resolvedLink =
        linkedPath.startsWith("/") || slash < 0
          ? linkedPath
          : `${currentPath.slice(0, slash + 1)}${linkedPath}`;
      router.push({ pathname: "/document", params: { runId, filePath: resolvedLink } } as Href);
    },
    [filePath, router, runId, state],
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.systemBackground }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.lg,
        paddingBottom: spacing.xxl,
      }}
    >
      {state.status === "loading" ? (
        <DocumentMessage>Loading document…</DocumentMessage>
      ) : state.status === "failed" ? (
        <DocumentMessage>{state.reason}</DocumentMessage>
      ) : (
        <View style={{ width: "100%", maxWidth: 720, alignSelf: "center" }}>
          <Markdown
            source={state.document.content}
            onOpenFile={openLinkedFile}
            presentation="document"
          />
        </View>
      )}
    </ScrollView>
  );
}

function DocumentMessage({ children }: { children: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl }}>
      <ThemedText
        variant="subhead"
        selectable
        style={{ color: colors.secondaryLabel, textAlign: "center" }}
      >
        {children}
      </ThemedText>
    </View>
  );
}
