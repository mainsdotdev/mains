import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { iconTintClass, parseIcon, type IconComponent } from "@/lib/icon-registry";

// Matching path commands let the cover unfold continuously instead of swapping glyphs.
// Its bottom edge stays at y=21, anchoring the motion at the folder's hinge.
const CLOSED_BACK = "M2 11 L2 7.944 C2 6.128 2 5.22 2.38 4.538 C2.644 4.054 3.054 3.644 3.538 3.38 C4.22 3 5.128 3 6.944 3 L7.044 3 C8.108 3 8.69 3 9.2 3.191 L12 7 L18 7 C19.4 7 20.1 7 20.635 7.272 C21.105 7.512 21.488 7.895 21.728 8.365 C22 8.9 22 9.6 22 11 L22 11 M12 7 L8 7";
const OPEN_BACK = "M2 19 L2 7.549 C2 6.105 2 5.383 2.243 4.816 C2.548 4.111 3.111 3.548 3.816 3.243 C4.383 3 5.098 3 6.55 3 L7.044 3 C7.651 3 8.225 3.274 8.601 3.745 L10.418 6 L16 6 C17.4 6 18.1 6 18.635 6.272 C19.105 6.512 19.488 6.895 19.728 7.365 C20 7.9 20 8.6 20 10 L20 11 M10.418 6 L7 6";
const CLOSED_COVER = "M2 11 L2 11 C2 9.344 2 8.516 2.758 7.758 C3.516 7 4.344 7 6 7 L18 7 C19.656 7 20.484 7 21.242 7.758 C22 8.516 22 9.344 22 11 L22 17 C22 18.656 22 19.484 21.242 20.242 C20.484 21 19.656 21 18 21 L6 21 C4.344 21 3.516 21 2.758 20.242 C2 19.484 2 18.656 2 17 Z";
const OPEN_COVER = "M3.158 15.514 L3.456 14.772 C4.19 12.945 4.557 12.032 5.322 11.516 C6.088 11 7.076 11 9.052 11 L17.112 11 C19.8 11 21.145 11 21.742 11.879 C22.34 12.758 21.84 14 20.842 16.486 L20.544 17.228 C19.81 19.055 19.443 19.968 18.678 20.484 C17.912 21 16.924 21 14.948 21 L6.888 21 C4.2 21 2.855 21 2.258 20.121 C1.66 19.243 2.16 18 3.158 15.514 Z";

function AnimatedProjectFolder({ expanded }: { expanded: boolean }) {
  const reducedMotion = useReducedMotion();
  const transition = reducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, duration: 0.32, bounce: 0 };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="size-3.5 text-primary-950 dark:text-primary"
    >
      <motion.path
        initial={false}
        animate={{ d: expanded ? OPEN_BACK : CLOSED_BACK }}
        transition={transition}
      />
      <motion.path
        initial={false}
        animate={{ d: expanded ? OPEN_COVER : CLOSED_COVER }}
        transition={transition}
      />
    </svg>
  );
}

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
  return <AnimatedProjectFolder expanded={expanded} />;
}
