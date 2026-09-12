import { useEffect, useState } from "react";
import { StyleSheet, View, type ColorValue } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { colors, useProviderAccent } from "@/theme";

/**
 * The desktop's spinner family (`components/ui/ascii-spinner.tsx` and the
 * four shapes behind it), in native terms.
 *
 * Every shape is the same idea: a handful of tiny squares, each running one
 * brightness pulse on its own phase, so that the lit ones appear to move —
 * diagonally across a grid (`square`), down it (`download`), at random
 * (`generate`), or around a ring (`circle`). The desktop does this with CSS
 * keyframes and per-cell `animation-delay`s; here one clock per spinner runs
 * on the UI thread and each cell derives its own moment from it, so nothing
 * reaches the JS thread while it spins. The phase tables are the desktop's,
 * number for number.
 */
export type AsciiSpinnerKind = "square" | "download" | "generate" | "circle";

/** Side of the square grids. */
const GRID = 3;
/** Between cells — the desktop's `gap-px`. */
const GAP = 1;
/** The desktop's `cubic-bezier(0.37, 0, 0.63, 1)`: zero velocity at both ends. */
function easeInOutSine(k: number): number {
  "worklet";
  return -(Math.cos(Math.PI * k) - 1) / 2;
}
function frac(x: number): number {
  "worklet";
  return ((x % 1) + 1) % 1;
}

/**
 * A pulse: the cell's brightness over one of its own cycles, as keyframes
 * eased between, and what that brightness means for opacity and scale.
 */
interface Pulse {
  frames: readonly { at: number; v: number }[];
  opacity: readonly [number, number];
  scale: readonly [number, number];
}

/** `toolSquarePulse`: a bump in the first half, dark for the second. */
const SQUARE_PULSE: Pulse = {
  frames: [
    { at: 0, v: 0 },
    { at: 0.24, v: 1 },
    { at: 0.48, v: 0 },
    { at: 1, v: 0 },
  ],
  opacity: [0, 1],
  scale: [0.02, 1],
};
/** `generateSquareTwinkle`: a slow breath from faint to full and back. */
const TWINKLE_PULSE: Pulse = {
  frames: [
    { at: 0, v: 0 },
    { at: 0.5, v: 1 },
    { at: 1, v: 0 },
  ],
  opacity: [0.08, 1],
  scale: [0.4, 1],
};
/** `circleDotPulse`: a quick flare with a long tail. */
const CIRCLE_PULSE: Pulse = {
  frames: [
    { at: 0, v: 0 },
    { at: 0.18, v: 1 },
    { at: 0.6, v: 0 },
    { at: 1, v: 0 },
  ],
  opacity: [0.12, 1],
  scale: [0.6, 1],
};

/**
 * One pulsing layer of a cell. `rate` is how many of its cycles fit in one
 * turn of the spinner's clock; `shift` is its CSS `animation-delay`, as a
 * fraction of its cycle — negative to start mid-cycle, as on the desktop.
 */
interface Layer {
  rate: number;
  shift: number;
}

/** The desktop's `PEAK`: where in the cycle the bump lands. */
const PEAK = 0.28;

/** Two diagonal sweeps: top-left → bottom-right, then bottom-left → top-right. */
const SQUARE_CELLS: Layer[][] = Array.from({ length: GRID * GRID }, (_, i) => {
  const row = Math.floor(i / GRID);
  const col = i % GRID;
  const max = (GRID - 1) * 2;
  const sweep = 0.25;
  return [
    { rate: 1, shift: ((row + col) / max) * sweep - PEAK },
    { rate: 1, shift: 0.5 + ((GRID - 1 - row + col) / max) * sweep - PEAK },
  ];
});

/** Two top-to-bottom sweeps, a whole row at a time. */
const DOWNLOAD_CELLS: Layer[][] = Array.from({ length: GRID * GRID }, (_, i) => {
  const row = Math.floor(i / GRID);
  const max = GRID - 1;
  const sweep = 0.3;
  return [
    { rate: 1, shift: (row / max) * sweep - PEAK },
    { rate: 1, shift: 0.5 + (row / max) * sweep - PEAK },
  ];
});

/**
 * The twinkle's tempos. The desktop rolls any duration between 900 and 2000ms;
 * these are the ones in that range that divide the clock's period, so a cell
 * never jumps when the clock wraps.
 */
const TWINKLE_PERIOD = 6000;
const TWINKLE_TEMPOS = [1000, 1200, 1500, 2000];
function rollTwinkle(): Layer[][] {
  return Array.from({ length: GRID * GRID }, () => {
    const duration = TWINKLE_TEMPOS[Math.floor(Math.random() * TWINKLE_TEMPOS.length)];
    const delay = -Math.round(Math.random() * 2000);
    return [{ rate: TWINKLE_PERIOD / duration, shift: delay / duration }];
  });
}

/** Dots around the ring; each peaks `1/DOTS` of a cycle after its neighbour. */
const DOTS = 8;
/** Ring radius as a fraction of the box — with 24% dots the ring just fills it. */
const RING_RADIUS = 0.38;
const CIRCLE_DOTS = Array.from({ length: DOTS }, (_, i) => {
  const angle = (i / DOTS) * 2 * Math.PI - Math.PI / 2;
  return {
    x: 0.5 + RING_RADIUS * Math.cos(angle),
    y: 0.5 + RING_RADIUS * Math.sin(angle),
    layer: { rate: 1, shift: i / DOTS - 1 } as Layer,
  };
});

/**
 * Compact loading indicator. `kind` picks the shape; the color is the
 * provider's, when one is given, and the label color otherwise — or whatever
 * `color` says. `size` is the box's side; the desktop's default is 12.
 */
export function AsciiSpinner({
  kind = "square",
  size = 12,
  providerId,
  color,
}: {
  kind?: AsciiSpinnerKind;
  size?: number;
  /** Tints the spinner in the provider's brand color. */
  providerId?: string | null;
  /** An explicit tint, over the provider's. */
  color?: ColorValue;
}) {
  const accent = useProviderAccent(providerId);
  const tint: ColorValue = color ?? (providerId ? accent : colors.label);
  const [twinkle] = useState(rollTwinkle);

  const period = kind === "circle" ? 900 : kind === "generate" ? TWINKLE_PERIOD : 2000;
  const reduceMotion = useReducedMotion();
  const clock = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      // A still frame from partway through — some cells lit, none moving.
      clock.value = 0.3;
      return;
    }
    clock.value = 0;
    clock.value = withRepeat(withTiming(1, { duration: period, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(clock);
  }, [clock, period, reduceMotion]);

  if (kind === "circle") {
    const dot = size * 0.24;
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: size, height: size }}
      >
        {CIRCLE_DOTS.map(({ x, y, layer }, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              left: x * size - dot / 2,
              top: y * size - dot / 2,
              width: dot,
              height: dot,
            }}
          >
            <Cell clock={clock} pulse={CIRCLE_PULSE} layers={[layer]} color={tint} />
          </View>
        ))}
      </View>
    );
  }

  const cells = kind === "download" ? DOWNLOAD_CELLS : kind === "generate" ? twinkle : SQUARE_CELLS;
  const pulse = kind === "generate" ? TWINKLE_PULSE : SQUARE_PULSE;
  const side = (size - GAP * (GRID - 1)) / GRID;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, flexDirection: "row", flexWrap: "wrap", gap: GAP }}
    >
      {cells.map((layers, i) => (
        <View key={i} style={{ width: side, height: side }}>
          <Cell clock={clock} pulse={pulse} layers={layers} color={tint} />
        </View>
      ))}
    </View>
  );
}

/** A cell's pulsing layers, stacked — the desktop's `::before` and `::after`. */
function Cell({
  clock,
  pulse,
  layers,
  color,
}: {
  clock: SharedValue<number>;
  pulse: Pulse;
  layers: Layer[];
  color: ColorValue;
}) {
  return (
    <>
      {layers.map((layer, i) => (
        <PulseLayer key={i} clock={clock} pulse={pulse} layer={layer} color={color} />
      ))}
    </>
  );
}

function PulseLayer({
  clock,
  pulse,
  layer,
  color,
}: {
  clock: SharedValue<number>;
  pulse: Pulse;
  layer: Layer;
  color: ColorValue;
}) {
  const style = useAnimatedStyle(() => {
    const u = frac(clock.value * layer.rate - layer.shift);
    const frames = pulse.frames;
    let v = frames[frames.length - 1].v;
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      if (u >= a.at && u < b.at) {
        v = a.v + (b.v - a.v) * easeInOutSine((u - a.at) / (b.at - a.at));
        break;
      }
    }
    return {
      opacity: pulse.opacity[0] + (pulse.opacity[1] - pulse.opacity[0]) * v,
      transform: [{ scale: pulse.scale[0] + (pulse.scale[1] - pulse.scale[0]) * v }],
    };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color, borderRadius: 1 }, style]} />;
}
