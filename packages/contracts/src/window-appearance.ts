/** Renderer theme mirrored into this desktop client's native window backdrop. */
export interface WindowAppearance {
  light: { translucent: boolean; backgroundColor: string };
  dark: { translucent: boolean; backgroundColor: string };
}
