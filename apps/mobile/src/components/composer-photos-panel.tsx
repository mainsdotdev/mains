import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import {
  AssetField,
  MediaType,
  Query,
  type AssetMetadata,
} from "expo-media-library";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { colors, motion, radius, shadows, spacing } from "@/theme";

import type { ComposerCameraFrame } from "./composer-camera-panel";
import { ComposerPanelControl, ComposerPanelPill } from "./composer-panel-control";
import { ThemedText } from "./themed-text";

const PHOTOS_MORPH_MS = 280;
const COLUMNS = 3;
const GRID_GAP = 2;
/** One screenful and change, so the first scroll never waits on a fetch. */
const PAGE_SIZE = 60;

/**
 * The recents grid that opens in place of a system picker, grown from the
 * attachment menu the same way the camera is.
 *
 * The grid only ever holds `ph://` ids and hands them back unresolved: turning
 * one into a file downloads the iCloud original, which is far too expensive to
 * do for a thumbnail and is left to the caller, once, for what was chosen.
 */
export function ComposerPhotosPanel({
  source,
  target,
  accent,
  onAdd,
  onOpenSystemPicker,
  onReturnToMenu,
  onClose,
  onError,
}: {
  source: ComposerCameraFrame;
  target: ComposerCameraFrame;
  /** Tints selection, as it tints the send button: whose run this is. */
  accent: string;
  onAdd: (assetIds: string[]) => Promise<void>;
  onOpenSystemPicker: () => void;
  onReturnToMenu: () => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const collapseCompletionRef = useRef<(() => void) | null>(null);
  const exhaustedRef = useRef(false);
  const loadingRef = useRef(false);
  const [assets, setAssets] = useState<AssetMetadata[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const reduceMotion = useReducedMotion();
  const left = useSharedValue(reduceMotion ? target.left : source.left);
  const top = useSharedValue(reduceMotion ? target.top : source.top);
  const width = useSharedValue(reduceMotion ? target.width : source.width);
  const height = useSharedValue(reduceMotion ? target.height : source.height);
  const controlsOpacity = useSharedValue(0);
  const surfaceOpacity = useSharedValue(1);
  const cornerRadius = useSharedValue(radius.xl + 10);

  const frameStyle = useAnimatedStyle(() => ({
    left: left.value,
    top: top.value,
    width: width.value,
    height: height.value,
    borderRadius: cornerRadius.value,
  }));
  const controlsStyle = useAnimatedStyle(() => ({ opacity: controlsOpacity.value }));
  const surfaceStyle = useAnimatedStyle(() => ({ opacity: surfaceOpacity.value }));

  useEffect(() => {
    if (reduceMotion) {
      left.set(target.left);
      top.set(target.top);
      width.set(target.width);
      height.set(target.height);
      controlsOpacity.set(withTiming(1, { duration: motion.fast }));
      return () => {
        cancelAnimation(controlsOpacity);
        cancelAnimation(surfaceOpacity);
        cancelAnimation(cornerRadius);
      };
    }

    const spring = { duration: PHOTOS_MORPH_MS, dampingRatio: 1 };
    left.set(withSpring(target.left, spring));
    top.set(withSpring(target.top, spring));
    width.set(withSpring(target.width, spring));
    height.set(withSpring(target.height, spring));
    controlsOpacity.set(withDelay(100, withTiming(1, { duration: motion.fast })));

    return () => {
      cancelAnimation(left);
      cancelAnimation(top);
      cancelAnimation(width);
      cancelAnimation(height);
      cancelAnimation(controlsOpacity);
      cancelAnimation(surfaceOpacity);
      cancelAnimation(cornerRadius);
    };
  }, [
    controlsOpacity,
    cornerRadius,
    height,
    left,
    reduceMotion,
    surfaceOpacity,
    target.height,
    target.left,
    target.top,
    target.width,
    top,
    width,
  ]);

  useEffect(() => {
    let cancelled = false;
    const loadFirstPage = async () => {
      loadingRef.current = true;
      try {
        const page = await queryPhotos(0);
        if (cancelled) return;
        exhaustedRef.current = page.length < PAGE_SIZE;
        setAssets(page);
      } catch (caught) {
        if (cancelled) return;
        setAssets([]);
        onError(
          caught instanceof Error ? caught.message : "Could not read your photos",
        );
      } finally {
        loadingRef.current = false;
      }
    };
    void loadFirstPage();
    return () => {
      cancelled = true;
    };
    // The first page is fetched once, on mount. `onError` only reports, and
    // listing it would refetch the library every time the composer re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = () => {
    if (loadingRef.current || exhaustedRef.current || !assets) return;
    loadingRef.current = true;
    const offset = assets.length;
    void queryPhotos(offset)
      .then((page) => {
        exhaustedRef.current = page.length < PAGE_SIZE;
        // Photos taken while the grid is open shift the window, so the same id
        // can arrive twice; the grid is keyed by id and would warn.
        setAssets((current) => {
          if (!current) return page;
          const known = new Set(current.map((asset) => asset.id));
          return [...current, ...page.filter((asset) => !known.has(asset.id))];
        });
      })
      .catch(() => {
        exhaustedRef.current = true;
      })
      .finally(() => {
        loadingRef.current = false;
      });
  };

  const finishCollapse = () => {
    const completion = collapseCompletionRef.current;
    collapseCompletionRef.current = null;
    completion?.();
  };

  const collapse = (completion: () => void) => {
    if (collapseCompletionRef.current) return;
    collapseCompletionRef.current = completion;
    if (reduceMotion) {
      controlsOpacity.set(
        withTiming(0, { duration: motion.fast }, (finished) => {
          if (finished) runOnJS(finishCollapse)();
        }),
      );
      return;
    }
    const spring = { duration: PHOTOS_MORPH_MS, dampingRatio: 1 };
    controlsOpacity.set(withTiming(0, { duration: motion.fast }));
    left.set(withSpring(source.left, spring));
    top.set(withSpring(source.top, spring));
    width.set(withSpring(source.width, spring));
    height.set(
      withSpring(source.height, spring, (finished) => {
        if (finished) runOnJS(finishCollapse)();
      }),
    );
    cornerRadius.set(withSpring(radius.xl + 8, spring));
  };

  const dismiss = (completion: () => void) => {
    if (collapseCompletionRef.current) return;
    collapseCompletionRef.current = completion;
    controlsOpacity.set(withTiming(0, { duration: motion.fast }));
    surfaceOpacity.set(
      withTiming(0, { duration: motion.fast }, (finished) => {
        if (finished) runOnJS(finishCollapse)();
      }),
    );
  };

  const toggle = (assetId: string) => {
    void Haptics.selectionAsync();
    setSelected((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId],
    );
  };

  const add = async () => {
    if (adding || selected.length === 0) return;
    setAdding(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      // Resolving the files first means the strip's thumbnails are ready by
      // the time the panel is out of the way, instead of popping in after it.
      await onAdd(selected);
      dismiss(onClose);
    } catch (caught) {
      setAdding(false);
      onError(caught instanceof Error ? caught.message : "Could not add those photos");
    }
  };

  const tile = (target.width - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          zIndex: 2,
          borderRadius: radius.xl + 10,
          borderCurve: "continuous",
          overflow: "hidden",
          backgroundColor: "#000000",
          boxShadow: shadows.overlay,
        },
        frameStyle,
        surfaceStyle,
      ]}
    >
      {assets === null ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.onTint} />
        </View>
      ) : assets.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.xl,
          }}
        >
          {/* The surface is fixed black in both themes, so the semantic
              label colors would invert out of legibility here. */}
          <ThemedText
            variant="subhead"
            style={{ textAlign: "center", color: colors.onTint, opacity: 0.7 }}
          >
            No photos here yet. Open All Photos to browse your whole library.
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={assets}
          keyExtractor={(asset) => asset.id}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{
            gap: GRID_GAP,
            // Clears the floating controls, so the last row is reachable.
            paddingBottom: 76 + spacing.md,
          }}
          onEndReached={loadMore}
          onEndReachedThreshold={1.5}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const order = selected.indexOf(item.id);
            return (
              <PhotoTile
                accent={accent}
                asset={item}
                order={order}
                size={tile}
                onPress={() => toggle(item.id)}
              />
            );
          }}
        />
      )}

      <Animated.View
        pointerEvents={adding ? "none" : "box-none"}
        style={[{ position: "absolute", inset: 0 }, controlsStyle]}
      >
        <ComposerPanelPill
          label="Browse all photos"
          icon="photo.on.rectangle"
          onPress={() => dismiss(onOpenSystemPicker)}
          style={{ right: spacing.md, top: spacing.md }}
        >
          <ThemedText variant="footnote" style={{ color: colors.onTint }}>
            All Photos
          </ThemedText>
        </ComposerPanelPill>

        <ComposerPanelControl
          label="Back to attachment menu"
          icon="chevron.left"
          onPress={() => collapse(onReturnToMenu)}
          style={{ left: spacing.md, bottom: spacing.md }}
        />

        {selected.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addLabel(selected.length)}
            disabled={adding}
            onPress={() => void add()}
            style={({ pressed }) => ({
              position: "absolute",
              right: spacing.md,
              bottom: spacing.md,
              height: 56,
              minWidth: 160,
              borderRadius: radius.full,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: spacing.ml,
              backgroundColor: accent,
              opacity: adding ? 0.6 : pressed ? 0.8 : 1,
            })}
          >
            {adding ? (
              <ActivityIndicator color={colors.onTint} />
            ) : (
              <ThemedText variant="headline" style={{ color: colors.onTint }}>
                {addLabel(selected.length)}
              </ThemedText>
            )}
          </Pressable>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

function PhotoTile({
  accent,
  asset,
  order,
  size,
  onPress,
}: {
  accent: string;
  asset: AssetMetadata;
  order: number;
  size: number;
  onPress: () => void;
}) {
  const selected = order >= 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={asset.filename ?? "Photo"}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ width: size, height: size }}
    >
      <Image
        source={{ uri: asset.id }}
        contentFit="cover"
        recyclingKey={asset.id}
        transition={120}
        style={{ width: "100%", height: "100%", backgroundColor: colors.fill }}
      />
      {selected ? (
        <>
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(0, 0, 0, 0.28)",
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              right: 6,
              bottom: 6,
              minWidth: 26,
              height: 26,
              paddingHorizontal: 6,
              borderRadius: radius.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: accent,
              borderWidth: 2,
              borderColor: "rgba(255, 255, 255, 0.92)",
            }}
          >
            <ThemedText
              variant="caption"
              style={{ color: colors.onTint, fontWeight: "700" }}
            >
              {order + 1}
            </ThemedText>
          </View>
        </>
      ) : null}
    </Pressable>
  );
}

function addLabel(count: number): string {
  return `Add ${count} photo${count === 1 ? "" : "s"}`;
}

function queryPhotos(offset: number): Promise<AssetMetadata[]> {
  // `exeForMetadata` stops short of resolving each asset's file path, which is
  // the whole cost of a page; ids are all the grid renders from.
  return new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .offset(offset)
    .limit(PAGE_SIZE)
    .exeForMetadata();
}
