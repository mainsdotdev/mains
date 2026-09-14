import { Button } from "@/components/ui";
import { SelectOption } from "@/components/ui/icons";

interface QuickActionButtonProps {
  label: string;
  onClick: () => void;
  hasArrow?: boolean;
  icon?: React.ReactNode;
}

export function QuickActionButton({
  label,
  onClick,
  hasArrow,
  icon,
}: QuickActionButtonProps) {
  return (
    <Button
      variant="bare"
      onClick={onClick}
      className=" px-3 py-1.5 cursor-pointer text-s duration-200 transition-all rounded-xl
      text-primary-900 dark:text-primary flex items-center gap-2 glass-surface opacity-80"
    >
      {icon && <span>{icon}</span>}
      <span>{label}</span>
      {hasArrow && <SelectOption className="ml-1 size-3" />}
    </Button>
  );
}
