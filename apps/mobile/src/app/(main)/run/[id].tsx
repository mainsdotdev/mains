import { Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { View } from "react-native";

import { backendSession } from "@/backend/backend-session";
import { RunView, goHome } from "@/features/runs";
import { useRunTitle } from "@/lib/use-run-title";

/** One run under a navigation bar: opened from a list, a search, or a fork. */
export default function RunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const runId = typeof id === "string" ? id : "";
  const headerHeight = useHeaderHeight();
  const title = useRunTitle(runId);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: title ?? "Run" }} />

      <RunView runId={runId} topInset={headerHeight} />

      {process.env.EXPO_OS === "ios" && (
        <Stack.Toolbar placement="right">
          {/* Declared before the menu, so it sits to the left of it. */}
          <Stack.Toolbar.Button icon="square.and.pencil" accessibilityLabel="New run" onPress={goHome}>
            New run
          </Stack.Toolbar.Button>
          <Stack.Toolbar.Menu icon="ellipsis">
            <Stack.Toolbar.MenuAction icon="arrow.clockwise" onPress={() => void backendSession.refresh()}>
              Sync now
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
    </View>
  );
}
