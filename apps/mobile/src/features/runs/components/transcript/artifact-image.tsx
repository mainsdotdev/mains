import { Image } from "expo-image";
import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions } from "react-native";

import { backendSession } from "@/backend/backend-session";
import type { ArtifactImage } from "@mains/contracts/runs";
import type { TranscriptImage } from "@/lib/transcript";
import { colors, radius, spacing } from "@/theme";

import { ThemedText } from "@/components/ui";

/**
 * Pixels fetched this session, oldest first; the oldest go once it fills. A
 * failed fetch is dropped at once, so the next look asks again.
 */
const loaded = new Map<number, Promise<ArtifactImage>>();
const LOADED_LIMIT = 48;

export function loadImage(artifactId: number): Promise<ArtifactImage> {
  const hit = loaded.get(artifactId);
  if (hit) return hit;
  const promise = backendSession.readArtifactImage(artifactId).catch((error: unknown) => {
    loaded.delete(artifactId);
    throw error;
  });
  loaded.set(artifactId, promise);
  if (loaded.size > LOADED_LIMIT) {
    const oldest = loaded.keys().next().value;
    if (oldest !== undefined) loaded.delete(oldest);
  }
  return promise;
}

/** How tall a single image may stand in the transcript, and a gallery tile. */
const SINGLE_MAX_HEIGHT = 320;
const TILE_HEIGHT = 170;
const TILE_MAX_WIDTH = 260;

/**
 * Images an agent produced, as the desktop shows them: one alone fills the
 * column; several stand side by side as tiles that scroll. Each asks the Mac
 * for its pixels the first time it is on screen.
 */
export function ImageGallery({ images }: { images: TranscriptImage[] }) {
  const { width: windowWidth } = useWindowDimensions();
  const columnWidth = windowWidth - spacing.md * 2;

  if (images.length === 1) {
    return <ArtifactImageView image={images[0]} maxWidth={columnWidth} maxHeight={SINGLE_MAX_HEIGHT} />;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Bleed to the screen's edges, so the row scrolls out from under the margin.
      style={{ marginHorizontal: -spacing.md }}
      contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}
    >
      {images.map((image) => (
        <ArtifactImageView
          key={image.artifactId}
          image={image}
          maxWidth={TILE_MAX_WIDTH}
          maxHeight={TILE_HEIGHT}
          fixedHeight
        />
      ))}
    </ScrollView>
  );
}

type Loaded =
  | { status: "loading" }
  | { status: "ready"; image: ArtifactImage }
  | { status: "failed"; reason: string };

/** Pixel dimensions: the Mac's when it scaled the image, else measured on load. */
type Size = { width: number; height: number };

function ArtifactImageView({
  image,
  maxWidth,
  maxHeight,
  fixedHeight = false,
}: {
  image: TranscriptImage;
  maxWidth: number;
  maxHeight: number;
  /** A gallery tile: always `maxHeight` tall, as wide as its shape allows. */
  fixedHeight?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<Loaded>({ status: "loading" });
  const [measured, setMeasured] = useState<Size | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadImage(image.artifactId).then(
      (loadedImage) => {
        if (!cancelled) setState({ status: "ready", image: loadedImage });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: "failed", reason: error instanceof Error ? error.message : "Could not load" });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [image.artifactId]);

  if (state.status === "failed") {
    return (
      <ThemedText variant="monoCaption" selectable>
        Image · {image.fileName} — {state.reason}
      </ThemedText>
    );
  }

  // Sized from the pixels' own shape, never cropped: a tall image stands
  // narrower than the column rather than losing its top and bottom. A file the
  // Mac sent untouched (WebP and the like) arrives unmeasured; it takes a
  // 4:3 box until the decoder reports its size.
  const size: Size | null =
    state.status === "ready" && state.image.width !== null && state.image.height !== null
      ? { width: state.image.width, height: state.image.height }
      : measured;
  const aspect = size ? size.width / Math.max(size.height, 1) : 4 / 3;
  const height = fixedHeight ? maxHeight : Math.min(maxHeight, maxWidth / aspect);
  const width = Math.min(maxWidth, height * aspect);

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={image.fileName}
      disabled={state.status !== "ready"}
      // The viewer reads the same session cache, so opening costs nothing.
      onPress={() =>
        router.push({
          pathname: "/image/[artifactId]",
          params: { artifactId: String(image.artifactId), fileName: image.fileName },
        } as Href)
      }
      style={({ pressed }) => ({
        width,
        height,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        overflow: "hidden",
        backgroundColor: colors.fill,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {state.status === "ready" ? (
        <Image
          source={{ uri: `data:${state.image.mime};base64,${state.image.base64}` }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={150}
          onLoad={(event) => {
            if (!size) setMeasured({ width: event.source.width, height: event.source.height });
          }}
        />
      ) : null}
    </Pressable>
  );
}
