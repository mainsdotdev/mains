/** Structural context for one element in a browser annotation. */
export interface BrowserSelectionElement {
  selector: string;
  tagName: string;
  text: string;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  pageRect: { x: number; y: number; width: number; height: number };
  scroll: { x: number; y: number };
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  componentName?: string;
  sourceFile?: string;
}

/** The host's resolved theme tokens, also used inside the isolated guest UI. */
export interface BrowserAnnotationTheme {
  surface: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
  accentForeground: string;
  fontFamily: string;
  /** Resolved paints from the renderer's glass utilities, for the shadow root. */
  glass?: { outline: string; selectionOutline: string; input: string };
}
