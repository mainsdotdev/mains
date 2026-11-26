import { useEffect, useId, useState, type ReactNode } from "react";

import { useIsDarkMode } from "@/hooks/use-is-dark-mode";
import { useThemeTokens } from "@/hooks/use-theme-tokens";
import { isHexColor, mixOklab } from "@/lib/color";

const MAX_SOURCE_LENGTH = 50_000;
const DIAGRAM_TOKENS = [
  "--color-accent",
  "--color-primary",
  "--color-primary-50",
  "--color-primary-100",
  "--color-primary-200",
  "--color-primary-300",
  "--color-primary-600",
  "--color-primary-800",
  "--color-primary-900",
  "--color-primary-950",
] as const;

const DIAGRAM_FONT = "system-ui, sans-serif";
const FLOWCHART_STYLES = `
  .node > rect.basic.label-container:not([rx]),
  .node > rect.basic.label-container[rx="0"] {
    rx: 10px;
    ry: 10px;
  }
  .clusters > .cluster > rect {
    rx: 14px;
    ry: 14px;
  }
  .cluster-label text { font-weight: 600; }
  .edgeLabel rect {
    rx: 4px;
    ry: 4px;
    opacity: 1;
  }
`;

type DiagramImage = {
  source: string;
  src: string;
  alt: string;
  width?: number;
  height?: number;
};

// Mermaid keeps its site configuration globally, including during async layout.
let renderQueue = Promise.resolve();

function diagramColors(
  tokens: Record<(typeof DIAGRAM_TOKENS)[number], string>,
  darkMode: boolean,
) {
  const background = darkMode ? tokens["--color-primary-950"] || "#0c0c0c" : tokens["--color-primary"] || "#ffffff";
  const surface = darkMode ? tokens["--color-primary-900"] || "#141414" : tokens["--color-primary-100"] || "#f7f7f6";
  const border = darkMode ? tokens["--color-primary-800"] || "#262625" : tokens["--color-primary-200"] || "#d3d3d3";
  const text = darkMode ? tokens["--color-primary-50"] || "#efeeee" : tokens["--color-primary-900"] || "#141414";
  const muted = darkMode ? tokens["--color-primary-300"] || "#b5b5b5" : tokens["--color-primary-600"] || "#6f6e69";
  const accent = tokens["--color-accent"];

  return {
    darkMode,
    background,
    primaryColor: isHexColor(surface) && isHexColor(accent)
      ? mixOklab(surface, accent, darkMode ? 0.18 : 0.08)
      : surface,
    primaryBorderColor: isHexColor(border) && isHexColor(accent)
      ? mixOklab(border, accent, darkMode ? 0.28 : 0.18)
      : border,
    primaryTextColor: text,
    secondaryColor: surface,
    tertiaryColor: surface,
    clusterBkg: surface,
    clusterBorder: border,
    titleColor: muted,
    lineColor: muted,
    arrowheadColor: muted,
    edgeLabelBackground: background,
    useGradient: false,
  };
}

export function MermaidDiagram({ source, fallback }: { source: string; fallback: ReactNode }) {
  const id = useId().replace(/[^\w-]/g, "_");
  const darkMode = useIsDarkMode();
  const tokens = useThemeTokens(DIAGRAM_TOKENS);
  const [image, setImage] = useState<DiagramImage | null>(null);

  useEffect(() => {
    if (source.length > MAX_SOURCE_LENGTH) return;

    let active = true;
    const render = renderQueue.then(async () => {
      if (!active) return;
      const { default: mermaid } = await import("mermaid");
      if (!active) return;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        suppressErrorRendering: true,
        maxTextSize: MAX_SOURCE_LENGTH,
        theme: "base",
        look: "classic",
        fontFamily: DIAGRAM_FONT,
        fontSize: 14,
        themeVariables: { ...diagramColors(tokens, darkMode), fontSize: "14px" },
        themeCSS: FLOWCHART_STYLES,
        flowchart: {
          wrappingWidth: 208,
          padding: 11,
          nodeSpacing: 36,
          rankSpacing: 36,
          subGraphTitleMargin: { top: 8, bottom: 4 },
        },
        secure: [
          ...(mermaid.mermaidAPI.defaultConfig.secure ?? []),
          "htmlLabels",
          "dompurifyConfig",
          "themeCSS",
        ],
      });

      // Layout needs an attached element. Keep it outside the transcript flow
      // and remove it even when a diagram fails partway through rendering.
      const scratch = document.createElement("div");
      scratch.inert = true;
      scratch.style.cssText = "position:fixed; left:-10000px; visibility:hidden";
      document.body.append(scratch);
      try {
        const { svg } = await mermaid.render(`mains-mermaid-${id}`, source, scratch);
        if (!active) return;

        const diagram = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
        if (diagram.localName !== "svg") return;
        const [, , width, height] = diagram.getAttribute("viewBox")?.split(/[\s,]+/).map(Number) ?? [];
        setImage({
          source,
          // Display the SVG in image mode so diagram markup stays outside the app DOM.
          src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          alt: diagram.querySelector("title")?.textContent?.trim() || "Mermaid diagram",
          width: width > 0 ? Math.ceil(width) : undefined,
          height: height > 0 ? Math.ceil(height) : undefined,
        });
      } finally {
        scratch.remove();
      }
    });
    renderQueue = render.catch(() => {
      if (active) setImage(null);
    });
    return () => { active = false; };
  }, [darkMode, id, source, tokens]);

  if (image?.source !== source) return fallback;
  return (
    <img
      className="mx-auto my-4 block h-auto max-w-full"
      src={image.src}
      alt={image.alt}
      width={image.width}
      height={image.height}
      onError={() => setImage((current) => current === image ? null : current)}
    />
  );
}
