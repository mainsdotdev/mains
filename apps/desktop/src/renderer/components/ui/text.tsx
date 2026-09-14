import { ElementType, HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../../lib/cn";

/**
 * Typography is three independent axes — size, tone, weight — and a `variant`
 * that is nothing more than a named preset over them.
 *
 * The axes exist because the app's real ramp is wider than any fixed list of
 * variants: `index.css` publishes nine steps between 9px and 30px, and a
 * neutral colour ramp five stops deep. Encoding every (size × tone × weight)
 * combination as its own variant name is combinatorial; encoding none of them
 * pushes callers into `className="text-s text-primary-800 dark:text-primary-200"`,
 * which is how the override sprawl started. So: presets for the common shapes,
 * axes for everything else, and `className` reserved for layout (truncate,
 * tabular-nums, spacing) rather than typography.
 *
 * An explicit axis always beats the variant's preset value.
 */

/**
 * Every step of the `--text-*` ramp declared in `index.css`, plus `inherit` for
 * text inside a control that already sizes it (`Button` ships `text-s`), where
 * restating the size would just be a second place to keep in sync.
 */
export type TextSize =
  | "inherit"
  | "xt"
  | "t"
  | "xxs"
  | "xs"
  | "s"
  | "sm"
  | "base"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl";

/**
 * Neutral prominence, loudest first, then the semantic colours.
 *
 * Each neutral stop is a light/dark *pair* — `faint` is the one exception, it
 * reads on both grounds unpaired. `contrast` sits a notch above `default` at
 * the ends of the ramp (950 / pure white) for the few places that want maximum
 * separation. `inherit` emits no colour at all, for text inside a control that
 * owns its own colour and hover states.
 */
export type TextTone =
  | "contrast"
  | "default"
  | "secondary"
  | "muted"
  | "subtle"
  | "faint"
  | "danger"
  | "warning"
  | "success"
  | "inherit";

export type TextWeight = "normal" | "medium" | "semibold" | "bold";

export type TextAlign = "left" | "center" | "right";

export type TextVariant =
  | "h1"
  | "h2"
  | "h3"
  | "body"
  | "muted"
  | "label"
  | "button"
  | "buttonSmall"
  | "error"
  | "caption"
  | "tiny";

export interface TextProps extends HTMLAttributes<HTMLElement> {
  variant?: TextVariant;
  size?: TextSize;
  tone?: TextTone;
  weight?: TextWeight;
  children: ReactNode;
  className?: string;
  as?: ElementType;
  align?: TextAlign;
  /**
   * Forwarded to the rendered element. React 19 passes `ref` through as an
   * ordinary prop, so measuring or positioning a node is no reason to drop back
   * to a bare `<div>` and hand-write the typography classes again. The element
   * type follows `as`, which the type system cannot narrow here.
   */
  ref?: Ref<any>;
}

// Every lookup below maps to a *literal* class string. Tailwind scans source
// text, so a computed `text-${size}` would compile to nothing at all.
const sizeStyles: Record<TextSize, string> = {
  inherit: "",
  xt: "text-xt",
  t: "text-t",
  xxs: "text-xxs",
  xs: "text-xs",
  s: "text-s",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
};

const toneStyles: Record<TextTone, string> = {
  contrast: "text-primary-950 dark:text-primary",
  default: "text-primary-900 dark:text-primary-100",
  secondary: "text-primary-800 dark:text-primary-200",
  muted: "text-primary-700 dark:text-primary-300",
  subtle: "text-primary-600 dark:text-primary-400",
  faint: "text-primary-500",
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
  inherit: "",
};

const weightStyles: Record<TextWeight, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

const alignStyles: Record<TextAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

interface VariantPreset {
  size: TextSize;
  tone: TextTone;
  /**
   * Left undefined where the variant has no opinion, so weight keeps
   * cascading from an ancestor instead of being reset to normal.
   */
  weight?: TextWeight;
  as: ElementType;
}

const variantPresets: Record<TextVariant, VariantPreset> = {
  h1: { size: "3xl", tone: "default", as: "h1" },
  h2: { size: "2xl", tone: "default", as: "h2" },
  h3: { size: "xl", tone: "default", as: "h3" },

  body: { size: "sm", tone: "default", as: "p" },
  muted: { size: "sm", tone: "muted", as: "p" },
  label: { size: "sm", tone: "muted", weight: "medium", as: "label" },

  // Control labels take their colour from the control, so it can restyle them
  // on hover, focus, and disabled without fighting a colour set here.
  //
  // `s` — not `sm` — because that is what `Button`'s base styles ship. The two
  // are adjacent steps (13px vs 14px), so a mismatch here does not look like a
  // bug at the call site; it just renders one button a notch off from every
  // other one, and `cn`'s tailwind-merge cannot catch it because the label is a
  // child element rather than a class on the button itself.
  button: { size: "sm", tone: "inherit", weight: "medium", as: "span" },
  buttonSmall: { size: "xs", tone: "inherit", weight: "medium", as: "span" },

  error: { size: "sm", tone: "danger", as: "p" },
  caption: { size: "xs", tone: "muted", as: "span" },
  tiny: { size: "s", tone: "default", as: "span" },
};

export default function Text({
  variant = "body",
  size,
  tone,
  weight,
  children,
  className,
  as,
  align,
  ...rest
}: TextProps) {
  const preset = variantPresets[variant];
  const Component = as || preset.as;
  const resolvedWeight = weight ?? preset.weight;

  return (
    <Component
      className={cn(
        sizeStyles[size ?? preset.size],
        toneStyles[tone ?? preset.tone],
        resolvedWeight && weightStyles[resolvedWeight],
        align && alignStyles[align],
        className
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}

/** The named presets, as components. Each still accepts every axis. */
type VariantProps = Omit<TextProps, "variant">;

const Heading1 = (props: VariantProps) => <Text variant="h1" {...props} />;
const Heading2 = (props: VariantProps) => <Text variant="h2" {...props} />;
const Heading3 = (props: VariantProps) => <Text variant="h3" {...props} />;
const Body = (props: VariantProps) => <Text variant="body" {...props} />;
const Muted = (props: VariantProps) => <Text variant="muted" {...props} />;
const Label = (props: VariantProps) => <Text variant="label" {...props} />;
const ErrorText = (props: VariantProps) => <Text variant="error" {...props} />;
const Caption = (props: VariantProps) => <Text variant="caption" {...props} />;
const Tiny = (props: VariantProps) => <Text variant="tiny" {...props} />;

export {
  Heading1,
  Heading2,
  Heading3,
  Body,
  Muted,
  Label,
  ErrorText,
  Caption,
  Tiny,
};
