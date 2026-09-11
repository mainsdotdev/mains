import { Stack } from "expo-router/stack";
import type { ReactNode } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import { useDrawerProgress } from "react-native-drawer-layout";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";

import { AiDataConsentProvider } from "@/components/ai-data-consent-provider";
import { colors, shadows, useBrandColors } from "@/theme";

/** Corner radius the main screen rounds into as the sidebar opens (≈ the device's). */
const CARD_RADIUS = 44;

/**
 * How much the card fades toward grey with the sidebar fully open: a wash of
 * the opposite tone, so black turns charcoal and white turns light grey —
 * the same background as the sidebar, set apart only by this dimming.
 */
const CARD_DIM = { dark: "rgba(255,255,255,0.08)", light: "rgba(0,0,0,0.10)" };

/**
 * The native stack under the sidebar. Transparent headers let iOS 26 draw its
 * own glass bar; the overview and settings use large titles, a run does not.
 */
export default function MainLayout() {
  const brand = useBrandColors();
  return (
    <AiDataConsentProvider>
      <SceneCard>
        <Stack
          screenOptions={{
            headerTransparent: true,
            headerShadowVisible: false,
            headerLargeTitleShadowVisible: false,
            headerLargeStyle: { backgroundColor: "transparent" },
            headerBlurEffect: "none",
            headerBackButtonDisplayMode: "minimal",
            // The tint is for the back button; titles stay in the label color.
            headerTintColor: brand.accent,
            headerTitleStyle: { color: colors.label },
            headerLargeTitleStyle: { color: colors.label },
            contentStyle: { backgroundColor: colors.systemBackground },
          }}
        >
          {/* Home draws its own floating controls; no navigation bar. */}
          <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="run/[id]" options={{ title: "" }} />
          <Stack.Screen name="workspace/[id]" options={{ title: "" }} />
          <Stack.Screen name="settings" options={{ title: "Settings", headerLargeTitle: true }} />
          <Stack.Screen
            name="ai-data-sharing"
            options={{ title: "AI Data Sharing", headerLargeTitle: true }}
          />
          <Stack.Screen
            name="pair"
            options={{ title: "Pair a Mac", presentation: "modal", headerLargeTitle: false }}
          />
          <Stack.Screen
            name="target"
            options={{
              presentation: "formSheet",
              headerShown: false,
              sheetGrabberVisible: true,
              sheetAllowedDetents: [0.5, 1],
              // Transparent content = Liquid Glass sheet on iOS 26+.
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
          <Stack.Screen
            name="model"
            options={{
              presentation: "formSheet",
              headerShown: false,
              sheetGrabberVisible: true,
              sheetAllowedDetents: [0.62, 1],
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
          <Stack.Screen
            name="search"
            options={{ presentation: "fullScreenModal", animation: "fade", headerShown: false }}
          />
          <Stack.Screen
            name="image/[artifactId]"
            options={{
              presentation: "transparentModal",
              animation: "fade",
              headerShown: false,
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
          <Stack.Screen
            name="run-options"
            options={{
              presentation: "formSheet",
              headerShown: false,
              sheetGrabberVisible: true,
              sheetAllowedDetents: [0.62, 1],
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
          <Stack.Screen
            name="subagents"
            options={{
              presentation: "formSheet",
              headerShown: false,
              sheetGrabberVisible: true,
              sheetAllowedDetents: [0.52, 1],
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
          <Stack.Screen
            name="ai-data-consent"
            options={{
              presentation: "formSheet",
              headerShown: false,
              sheetGrabberVisible: true,
              sheetAllowedDetents: [0.64, 1],
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
        </Stack>
      </SceneCard>
    </AiDataConsentProvider>
  );
}

/**
 * Rounds the whole screen into a card and dims it as the drawer slides it
 * aside — the ChatGPT/Claude sidebar feel. Driven by the drawer's progress
 * on the UI thread; the static background lives outside the animated style
 * so a platform color can be used there.
 */
function SceneCard({ children }: { children: ReactNode }) {
  const progress = useDrawerProgress();
  const scheme = useColorScheme();
  const rounding = useAnimatedStyle(() => ({
    borderRadius: interpolate(progress.value, [0, 1], [0, CARD_RADIUS]),
  }));
  const dimming = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1]),
  }));
  return (
    <Animated.View
      style={[
        {
          flex: 1,
          overflow: "hidden",
          borderCurve: "continuous",
          backgroundColor: colors.systemBackground,
          boxShadow: shadows.overlay,
        },
        rounding,
      ]}
    >
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: scheme === "dark" ? CARD_DIM.dark : CARD_DIM.light },
          dimming,
        ]}
      />
    </Animated.View>
  );
}
