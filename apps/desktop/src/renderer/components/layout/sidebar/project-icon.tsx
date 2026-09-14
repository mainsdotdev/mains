import type { ReactNode } from "react";
import { iconTintClass, parseIcon, type IconComponent } from "@/lib/icon-registry";
import { ProjectFolder, ProjectFolderOpen } from "@/components/ui/icons";

export function ProjectIcon({
  icon,
  projectName,
  expanded = false,
}: {
  icon: string | null;
  projectName: string;
  /** Only the default folder reacts: open lid while its group is expanded. */
  expanded?: boolean;
}): ReactNode {
  if (icon) {
    const parsed = parseIcon(icon);
    if (parsed.type === "icon") {
      const IconComp = parsed.value as IconComponent;
      return (
        <IconComp className={`size-3.5 ${iconTintClass(parsed.color)}`} />
      );
    }
    if (parsed.type === "emoji") {
      // An emoji here is the icon, not text — it sits in the same slot as the
      // `size-3.5` glyphs above and is sized to match them.
      return <span className="text-xs">{parsed.value as string}</span>;
    }
  }
  void projectName;
  const Folder = expanded ? ProjectFolderOpen : ProjectFolder;
  return <Folder className="size-3.5 text-primary-950 dark:text-primary" />;
}
