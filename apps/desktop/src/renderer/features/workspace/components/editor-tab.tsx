import { Code } from "@/components/ui/icons/space";
import { Text } from "@/components/ui";
import { BaseTab } from "./base-tab";

interface EditorTabProps {
  isActive: boolean;
  isFirst?: boolean;
  onClick: () => void;
  hasFile?: boolean;
  fileName?: string;
  onClose?: (e: React.MouseEvent) => void;
}

export function EditorTab({ isActive, isFirst, onClick, hasFile, fileName, onClose }: EditorTabProps) {
  return (
    <BaseTab
      isActive={isActive}
      isFirst={isFirst}
      onClick={onClick}
      onClose={onClose}
      tooltip={fileName || "Editor"}
      icon={<Code className="size-4 shrink-0 text-primary-800 dark:text-primary-200 hover:text-primary-900 dark:hover:text-primary-100 " />}
      label={
        <Text
          as="span"
          size="xs"
          weight="medium"
          className="tracking-tight truncate flex-1"
        >
          {fileName || "Editor"}
          {hasFile && <span className="ml-1">*</span>}
        </Text>
      }
    />
  );
}
