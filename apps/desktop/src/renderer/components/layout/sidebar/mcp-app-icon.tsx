import { useState } from "react";
import type { McpAppIcon as IconMetadata } from "@mains/contracts/mcp-apps";
import { Plugin } from "@/components/ui/icons";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";

export function McpAppIcon({ icons, isDarkMode }: { icons?: IconMetadata[]; isDarkMode: boolean }) {
  const [failed, setFailed] = useState<string[]>([]);
  const theme = isDarkMode ? "dark" : "light";
  const src = icons?.filter((icon) => !failed.includes(icon.src) && (!icon.theme || icon.theme === theme))
    .sort((left, right) => Number(right.theme === theme) - Number(left.theme === theme))[0]?.src;
  const url = useLocalImageUrl(src);
  if (!url) return <Plugin className="size-5" aria-hidden />;
  return <img src={url} alt="" aria-hidden className="size-5 shrink-0 object-contain" loading="lazy"
    onError={() => { if (src) setFailed((previous) => [...previous, src]); }} />;
}
