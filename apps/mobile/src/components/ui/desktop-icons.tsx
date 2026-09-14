import type { ColorValue } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

/**
 * Glyphs carried over from the desktop, path for path.
 *
 * Everywhere else the phone reaches for an SF Symbol, which keeps it native and
 * costs nothing. These are the exception because they sit on an agent's *work*
 * — its answer, and the subagents it spawned — next to the desktop's own marks
 * for the same things; one affordance in two places should not be two
 * different glyphs.
 *
 * Copied from `components/ui/icons/{fork,clipboard,check,bot}.tsx`, all on the
 * same 24-unit grid. They are chrome rather than registry shapes, which is why
 * they don't belong in `@mains/icons`, whose fill-only paths are the icons a
 * space or project is drawn with.
 */

interface GlyphProps {
  size?: number;
  color: ColorValue;
}

/** Git's branch mark — the desktop's `Fork`. */
export function ForkIcon({ size = 16, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 3v12"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={18} cy={6} r={3} stroke={color} strokeWidth={1.5} />
      <Circle cx={6} cy={18} r={3} stroke={color} strokeWidth={1.5} />
      <Path
        d="M18 9a9 9 0 0 1-9 9"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Two offset rounded squares — the desktop's `Clipboard`. */
export function ClipboardIcon({ size = 16, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M16 12.9v4.2c0 3.5-1.4 4.9-4.9 4.9H6.9C3.4 22 2 20.6 2 17.1v-4.2C2 9.4 3.4 8 6.9 8h4.2c3.5 0 4.9 1.4 4.9 4.9Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M22 6.9v4.2c0 3.5-1.4 4.9-4.9 4.9H16v-3.1C16 9.4 14.6 8 11.1 8H8V6.9C8 3.4 9.4 2 12.9 2h4.2C20.6 2 22 3.4 22 6.9Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** The acknowledgement after a copy — the desktop's `Check`. */
export function CheckIcon({ size = 16, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m4 12 4.95 4.95L19.557 6.343"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** The agent mark — the desktop's `Bot`, and the one filled glyph here. */
export function BotIcon({ size = 16, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        fill={color}
        fillRule="nonzero"
        d="M17.753 14a2.25 2.25 0 0 1 2.25 2.25v.905A3.75 3.75 0 0 1 18.696 20C17.13 21.344 14.89 22.001 12 22.001c-2.89 0-5.128-.657-6.691-2a3.75 3.75 0 0 1-1.305-2.844v-.907A2.25 2.25 0 0 1 6.254 14h11.5Zm0 1.5h-11.5a.75.75 0 0 0-.75.75v.907c0 .656.287 1.279.784 1.706C7.545 19.945 9.44 20.501 12 20.501c2.56 0 4.458-.556 5.719-1.639a2.25 2.25 0 0 0 .784-1.707v-.905a.75.75 0 0 0-.75-.75ZM11.9 2.007 12 2a.75.75 0 0 1 .743.649l.007.101v.75h3.5a2.25 2.25 0 0 1 2.25 2.25v4.505a2.25 2.25 0 0 1-2.25 2.25h-8.5a2.25 2.25 0 0 1-2.25-2.25V5.75A2.25 2.25 0 0 1 7.75 3.5h3.5v-.75a.75.75 0 0 1 .649-.743L12 2l-.101.007ZM16.25 5h-8.5a.75.75 0 0 0-.75.75v4.505c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75V5.75a.75.75 0 0 0-.75-.75Zm-6.5 1.5a1.25 1.25 0 1 1 0 2.499 1.25 1.25 0 0 1 0-2.499Zm4.492 0a1.25 1.25 0 1 1 0 2.499 1.25 1.25 0 0 1 0-2.499Z"
      />
    </Svg>
  );
}
