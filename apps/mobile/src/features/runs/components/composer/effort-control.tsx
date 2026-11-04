import * as Haptics from "expo-haptics";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { Card, Row, Toggle, ThemedText } from "@/components/ui";
import {
  effortControlFor,
  effortStopIndex,
  formatEffortLevel,
  modelOffersUltracode,
  type EffortControl as EffortControlKind,
} from "@/lib/models";
import { motion, shadows, spacing, useThemeColors } from "@/theme";

/**
 * Low → high, painted as a scale rather than a theme colour. The same
 * yellow-to-violet ramp as the reference picker. Off is the leftmost stop on
 * that one track; the plain colour is only whatever the thumb has not reached.
 */
const EFFORT_RAMP = [
  { color: "#F5D76E", positions: ["0%"] },
  { color: "#7DDE6A", positions: ["22%"] },
  { color: "#3DDCB4", positions: ["42%"] },
  { color: "#3B82F6", positions: ["64%"] },
  { color: "#6D5EF5", positions: ["82%"] },
  { color: "#C084FC", positions: ["100%"] },
] as const;

const THUMB = 30;
const TRACK = 26;
const HIT = 44;

function stopCenter(index: number, width: number, count: number): number {
  "worklet";
  if (count <= 1 || width <= THUMB) return width / 2;
  return THUMB / 2 + (index / (count - 1)) * (width - THUMB);
}

function thumbX(location: number, width: number): number {
  "worklet";
  const min = THUMB / 2;
  const max = width <= THUMB ? min : width - min;
  return Math.min(max, Math.max(min, location));
}

function stopIndexAt(x: number, width: number, count: number): number {
  "worklet";
  if (count <= 1 || width <= THUMB) return 0;
  const ratio = Math.min(1, Math.max(0, (x - THUMB / 2) / (width - THUMB)));
  return Math.round(ratio * (count - 1));
}

function tick() {
  void Haptics.selectionAsync();
}

function EffortSlider({
  stops,
  value,
  disabled,
  onChange,
}: {
  stops: readonly string[];
  value: string;
  disabled: boolean;
  onChange: (level: string) => void;
}) {
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const widthSv = useSharedValue(0);
  const lastSv = useSharedValue(-1);
  const draggingSv = useSharedValue(false);
  const activeSv = useSharedValue(false);
  const originX = useSharedValue(0);
  const originTouch = useSharedValue(0);
  const x = useSharedValue(0);
  const [width, setWidth] = useState(0);
  const [nearest, setNearest] = useState<number | null>(null);
  const stopsKey = stops.join("\0");
  const [tracked, setTracked] = useState({ value, stopsKey });
  if (tracked.value !== value || tracked.stopsKey !== stopsKey) {
    setTracked({ value, stopsKey });
    setNearest(null);
    if (width > 0 && !draggingSv.value) x.value = stopCenter(effortStopIndex(stops, value), width, stops.length);
  }
  const previewing = tracked.value === value && tracked.stopsKey === stopsKey ? nearest : null;
  const count = stops.length;
  const resting = effortStopIndex(stops, value);
  const snapMs = reduceMotion ? 0 : motion.fast;

  const preview = (next: number) => {
    if (disabled || width === 0) return;
    setNearest(next);
  };
  const finish = (next: number, moved: boolean) => {
    if (disabled || width === 0) return;
    const level = stops[next];
    if (level === undefined || level === value) {
      setNearest(null);
      return;
    }
    if (!moved) tick();
    setNearest(next);
    onChange(level);
  };
  const settle = (next: number, moved: boolean) => {
    "worklet";
    const target = stopCenter(next, widthSv.value, count);
    x.value = withTiming(target, { duration: snapMs }, (finished) => {
      if (finished) draggingSv.value = false;
    });
    runOnJS(finish)(next, moved);
  };

  const tap = Gesture.Tap().maxDistance(12).onEnd((event) => {
    draggingSv.value = true;
    settle(stopIndexAt(event.x, widthSv.value, count), false);
  });
  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onBegin((event) => {
      activeSv.value = true;
      draggingSv.value = true;
      lastSv.value = -1;
      originX.value = x.value;
      originTouch.value = event.x;
    })
    .onUpdate((event) => {
      const position = thumbX(originX.value + event.x - originTouch.value, widthSv.value);
      x.value = position;
      const next = stopIndexAt(position, widthSv.value, count);
      if (next === lastSv.value) return;
      const previous = lastSv.value;
      lastSv.value = next;
      if (previous === -1 && next === resting) return;
      runOnJS(tick)();
      runOnJS(preview)(next);
    })
    .onEnd((event) => {
      const position = thumbX(originX.value + event.x - originTouch.value, widthSv.value);
      const moved = lastSv.value !== -1;
      lastSv.value = -1;
      settle(stopIndexAt(position, widthSv.value, count), moved);
    })
    .onFinalize((_event, success) => {
      const wasActive = activeSv.value;
      activeSv.value = false;
      // A tap never activates the pan, so a failed pan must not pull the thumb
      // back while that tap is settling.
      if (success || !wasActive) return;
      draggingSv.value = false;
      lastSv.value = -1;
      x.value = stopCenter(resting, widthSv.value, count);
    });
  const gesture = Gesture.Exclusive(pan, tap);
  const index = previewing ?? resting;
  const label = previewing === null ? formatEffortLevel(value) : formatEffortLevel(stops[index] ?? "");
  const fillStyle = useAnimatedStyle(() => ({ width: Math.max(0, x.value) }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value - THUMB / 2 }] }));

  const step = (delta: number) => {
    if (disabled) return;
    if (value === "ultracode" && delta > 0) return;
    const next = Math.min(stops.length - 1, Math.max(0, effortStopIndex(stops, value) + delta));
    const level = stops[next];
    if (level !== undefined && level !== value) onChange(level);
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Effort"
      accessibilityValue={{ text: label }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") step(1);
        if (event.nativeEvent.actionName === "decrement") step(-1);
      }}
      style={{ opacity: disabled ? 0.5 : 1, paddingHorizontal: spacing.md, paddingTop: spacing.ms, paddingBottom: spacing.md }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm }}>
        <ThemedText variant="body">Effort</ThemedText>
        <ThemedText variant="body" style={{ color: colors.secondaryLabel }}>{label}</ThemedText>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          pointerEvents={disabled ? "none" : "auto"}
          onLayout={(event) => {
            const next = event.nativeEvent.layout.width;
            widthSv.value = next;
            if (!draggingSv.value) x.value = stopCenter(resting, next, count);
            setWidth((current) => (current === next ? current : next));
          }}
          style={{ height: HIT, justifyContent: "center" }}
        >
          <View style={{ height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.separator, overflow: "hidden" }}>
            {width > 0 && (
              <Animated.View style={[{ position: "absolute", left: 0, top: 0, bottom: 0, overflow: "hidden" }, fillStyle]}>
                <View
                  style={{
                    width,
                    height: TRACK,
                    experimental_backgroundImage: [{ type: "linear-gradient", direction: "to right", colorStops: EFFORT_RAMP }],
                  }}
                />
              </Animated.View>
            )}
            {width > 0 && stops.map((stop, stopIndex) => {
              if (stopIndex === index) return null;
              const dotCenter = stopCenter(stopIndex, width, stops.length);
              const onRamp = stopIndex < index;
              return (
                <View
                  key={stop || "off"}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    left: dotCenter - 2.5,
                    top: (TRACK - 5) / 2,
                    backgroundColor: onRamp ? "rgba(255,255,255,0.92)" : colors.tertiaryLabel,
                  }}
                />
              );
            })}
          </View>
          {width > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: "absolute",
                  width: THUMB,
                  height: THUMB,
                  borderRadius: THUMB / 2,
                  top: (HIT - THUMB) / 2,
                  backgroundColor: colors.onTint,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.separator,
                  boxShadow: shadows.raised,
                },
                thumbStyle,
              ]}
            />
          )}
        </View>
      </GestureDetector>
    </View>
  );
}

function ControlBody({
  control,
  effortLevel,
  disabled,
  open,
  onToggleOpen,
  onEffort,
  onThinking,
}: {
  control: Exclude<EffortControlKind, { kind: "hidden" }>;
  effortLevel: string;
  disabled: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onEffort: (level: string) => void;
  onThinking: (on: boolean) => void;
}) {
  switch (control.kind) {
    case "slider":
      return <EffortSlider stops={control.stops} value={effortLevel} disabled={disabled} onChange={onEffort} />;
    case "list":
      return (
        <>
          <Row
            first
            title="Effort"
            value={formatEffortLevel(effortLevel)}
            chevron={open ? "chevron.down" : "chevron.right"}
            disabled={disabled}
            onPress={onToggleOpen}
          />
          {open && control.options.map((level) => (
            <Row
              key={level || "off"}
              first={false}
              indented
              title={formatEffortLevel(level)}
              selected={effortLevel === level}
              disabled={disabled}
              onPress={() => {
                if (level !== effortLevel) onEffort(level);
              }}
            />
          ))}
        </>
      );
    case "thinking":
      return (
        <Row
          first
          title="Thinking"
          disabled={disabled}
          trailing={<Toggle label="Thinking" disabled={disabled} value={control.on} onChange={onThinking} />}
        />
      );
    case "toggle":
      return (
        <Row
          first
          title="Thinking"
          subtitle={formatEffortLevel(control.level)}
          disabled={disabled}
          trailing={(
            <Toggle
              label="Thinking"
              disabled={disabled}
              value={control.on}
              onChange={(on) => onEffort(on ? control.level : "")}
            />
          )}
        />
      );
    default: {
      const unreachable: never = control;
      return unreachable;
    }
  }
}

/** Effort for the selected model: a stepped slider, a Thinking switch, or the long list of stops. */
export function EffortControl({
  modelId,
  providerId,
  supportedLevels,
  effortLevel,
  thinkingMode,
  disabled,
  onEffort,
  onThinking,
}: {
  modelId: string;
  providerId: string;
  supportedLevels: readonly string[];
  effortLevel: string;
  thinkingMode: boolean;
  disabled: boolean;
  onEffort: (level: string) => void;
  onThinking: (on: boolean) => void;
}) {
  const control = effortControlFor(providerId, supportedLevels, effortLevel, thinkingMode);
  const [openFor, setOpenFor] = useState(modelId);
  const [open, setOpen] = useState(false);
  if (openFor !== modelId) {
    setOpenFor(modelId);
    setOpen(false);
  }
  if (control.kind === "hidden") return null;
  const ultracode = modelOffersUltracode(providerId, supportedLevels);

  return (
    <Card surface="sheet">
      <ControlBody
        control={control}
        effortLevel={effortLevel}
        disabled={disabled}
        open={open}
        onToggleOpen={() => setOpen((value) => !value)}
        onEffort={onEffort}
        onThinking={onThinking}
      />
      {ultracode && (
        <Row
          first={false}
          title="Ultracode"
          selected={effortLevel === "ultracode"}
          disabled={disabled}
          onPress={() => {
            if (effortLevel !== "ultracode") onEffort("ultracode");
          }}
        />
      )}
    </Card>
  );
}
