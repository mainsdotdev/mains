import { MenuView } from "@expo/ui/community/menu";
import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";

import { backendSession } from "@/backend/backend-session";
import { SFSymbol } from "@/components/ui";
import { useThemeColors } from "@/theme";
import { goHome } from "../home-run";

/** Android's native header uses React Native controls instead of the iOS toolbar API. */
export function RunHeaderActions({ runId, hasOutputs }: { runId: string; hasOutputs: boolean }) {
  const colors = useThemeColors();
  const router = useRouter();
  return <View style={{ flexDirection: "row", alignItems: "center" }}>
    {hasOutputs ? <Pressable accessibilityRole="button" accessibilityLabel="Outputs"
      hitSlop={4} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      onPress={() => router.push({ pathname: "/outputs", params: { runId } } as Href)}>
      <SFSymbol name="doc.on.doc" tint={colors.label} size={22} />
    </Pressable> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="New run" hitSlop={4}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }} onPress={goHome}>
      <SFSymbol name="square.and.pencil" tint={colors.label} size={22} />
    </Pressable>
    <MenuView actions={[{ id: "sync", title: "Sync now" }]}
      onPressAction={({ nativeEvent }) => { if (nativeEvent.event === "sync") void backendSession.refresh(); }}>
      <View accessibilityLabel="More" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
        <SFSymbol name="ellipsis" tint={colors.label} size={22} />
      </View>
    </MenuView>
  </View>;
}
