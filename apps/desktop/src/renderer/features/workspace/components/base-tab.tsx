import { Button, Text, Tooltip } from "@/components/ui";
import { Close } from "@/components/ui/icons";
import { useAppSelector } from "@/lib/redux/hooks";

interface BaseTabProps {
  isActive: boolean;
  isFirst?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: React.ReactNode;
  onClose?: (e: React.MouseEvent) => void;
  closeIcon?: React.ReactNode;
  /** Full title shown in a tooltip below the tab on hover */
  tooltip?: string;
}

const COLORS = {
  light: "var(--color-primary, #ffffff)",
  dark: "var(--color-primary-950)",
};

export function BaseTab({
  isActive,
  isFirst,
  onClick,
  icon,
  label,
  onClose,
  closeIcon,
  tooltip,
}: BaseTabProps) {
  const sidebarCollapsed = useAppSelector((state) => state.appSettings.sidebarCollapsed);

  const tab = (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      // `w-44` is the ideal width; tabs shrink from there as the strip fills up.
      // `min-w-28` is the floor (past it the strip scrolls) and is also what lets
      // them shrink at all — otherwise the flex auto minimum pins them at `w-44`.
      className="group relative flex items-center gap-1 pl-2.5 pr-6 py-1.5 cursor-pointer w-44 min-w-28 min-h-10"
    >
      {/* Active background layer — always rendered, opacity transitions */}
      <div
        className={` bg-primary dark:bg-primary-950 absolute inset-0 rounded-t-2xl transition-opacity duration-150 ease-out ${isActive ? "opacity-100" : "opacity-0"}`}

      />
      <div
        className={`absolute inset-0 rounded-t-2xl transition-opacity duration-150 ease-out hidden dark:block ${isActive ? "opacity-100" : "opacity-0"}`}
        style={{
          backgroundColor: COLORS.dark,
          boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--color-primary) 20%, transparent)",
        }}
      />

      {/* Inverted corners — always rendered, opacity transitions */}
      <InvertedCorner side="left" visible={isActive && (!isFirst || sidebarCollapsed)} />
      <InvertedCorner side="right" visible={isActive} />

      {/* Content */}
      <span className={`relative flex items-center justify-center size-4 shrink-0 transition-colors duration-150 ${
        isActive ? "text-primary-900 dark:text-primary-100" : "text-primary-900 dark:text-primary-100 hover:text-primary-900 dark:hover:text-primary-100"
      }`}>
        {icon}
      </span>
      {/* Active and idle resolved to the same colour, so the label just takes
          the default tone. */}
      <Text
        as="span"
        size="inherit"
        className="relative min-w-0 flex-1 mb-0.5 truncate transition-colors duration-150"
      >
        {typeof label === "string" ? (
          <Text as="span" size="xs" tone="inherit" weight="medium" className="tracking-tight">{label}</Text>
        ) : (
          label
        )}
      </Text>
      {onClose && (
        <CloseOverlay isActive={isActive} onClose={onClose} closeIcon={closeIcon} />
      )}
    </div>
  );

  if (!tooltip) return tab;

  return (
    <Tooltip
      content={tooltip}
      position="bottom"
      delay={400}
      className="max-w-xs whitespace-normal wrap-break-word"
    >
      {tab}
    </Tooltip>
  );
}

function InvertedCorner({ side, visible }: { side: "left" | "right"; visible: boolean }) {
  const isLeft = side === "left";

  return (
    <>
      <div
        className={`absolute bottom-0 ${isLeft ? "-left-3" : "-right-3"} size-3 block dark:hidden transition-opacity duration-150 ease-out ${visible ? "opacity-100" : "opacity-0"}`}
        style={{
          background: `radial-gradient(circle at ${isLeft ? "top left" : "top right"}, transparent 12px, ${COLORS.light} 12px)`,
        }}
      />
      <div
        className={`absolute bottom-0 ${isLeft ? "-left-3" : "-right-3"} size-3 hidden dark:block transition-opacity duration-150 ease-out ${visible ? "opacity-100" : "opacity-0"}`}
        style={{
          background: `radial-gradient(circle at ${isLeft ? "top left" : "top right"}, transparent 12px, ${COLORS.dark} 12px)`,
        }}
      />
    </>
  );
}

function CloseOverlay({
  isActive,
  onClose,
  closeIcon,
}: {
  isActive: boolean;
  onClose: (e: React.MouseEvent) => void;
  closeIcon?: React.ReactNode;
}) {
  return (
    <div
      className="absolute right-0 top-0.5 bottom-0 flex items-center pr-1.5 pl-6.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
    >
      {isActive && (
        <>
          <div
            className="absolute inset-0 block dark:hidden rounded-r-2xl"
            style={{ background: `linear-gradient(to left, ${COLORS.light} 60%, transparent)` }}
          />
          <div
            className="absolute inset-0 hidden dark:block rounded-r-2xl"
            style={{ background: `linear-gradient(to left, ${COLORS.dark} 60%, transparent)` }}
          />
        </>
      )}
      <Button
        onClick={onClose}
        className="relative z-(--z-base) p-1 glass-outline  hover:bg-primary/5 cursor-pointer rounded-full transition-all pointer-events-auto"
      >
        {closeIcon || <Close className="size-3.25 text-primary-900 dark:text-primary hover:text-primary-900 dark:hover:text-primary-100" />}
      </Button>
    </div>
  );
}
