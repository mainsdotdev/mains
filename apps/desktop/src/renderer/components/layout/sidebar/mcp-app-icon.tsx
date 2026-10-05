import { useId, useState } from "react";
import type { McpAppIcon as IconMetadata } from "@mains/contracts/mcp-apps";
import { Plugin } from "@/components/ui/icons";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { mcpAppRailMark } from "./mcp-app-rail-marks";

function isSvgIcon(icon: IconMetadata): boolean {
  if (icon.mimeType) return icon.mimeType.split(";")[0].trim().toLowerCase() === "image/svg+xml";
  return /^data:image\/svg\+xml[;,]/i.test(icon.src) || /\.svg(?:[?#]|$)/i.test(icon.src);
}

export function McpAppIcon({ icons, isDarkMode, className = "size-5", monochrome = false, tool }: {
  icons?: IconMetadata[]; isDarkMode: boolean; className?: string; monochrome?: boolean; tool?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const filterId = `mcp-app-icon-${useId()}`;
  const theme = isDarkMode ? "dark" : "light";
  const icon = icons?.filter((icon) => !failed.includes(icon.src) && (!icon.theme || icon.theme === theme))
    .sort((left, right) => Number(isSvgIcon(right)) - Number(isSvgIcon(left)) ||
      Number(right.theme === theme) - Number(left.theme === theme))[0];
  const src = icon?.src;
  const url = useLocalImageUrl(src);
  const railMark = monochrome && (!icon || !isSvgIcon(icon)) ? mcpAppRailMark(tool, { className, "aria-hidden": true }) : null;
  if (railMark) return railMark;
  if (!url) return <Plugin className={className} aria-hidden />;
  const image = <img key={src} src={url} alt="" aria-hidden className={`${monochrome ? "size-full" : className} shrink-0 object-contain`} loading="lazy"
    style={monochrome ? { filter: `url(#${filterId})` } : undefined}
    onError={() => { if (src) setFailed((previous) => previous.includes(src) ? previous : [...previous, src]); }} />;
  if (!monochrome) return image;
  return <span className={`${className} relative inline-flex shrink-0`} aria-hidden>
    <svg className="absolute size-0" aria-hidden>
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feFlood floodColor="currentColor" />
          <feComposite in2="SourceAlpha" operator="in" />
        </filter>
      </defs>
    </svg>
    {image}
  </span>;
}
