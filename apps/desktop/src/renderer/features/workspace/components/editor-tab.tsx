import { Code } from "@/components/ui/icons/space";
import { Picture } from "@/components/ui/icons";
import { Text } from "@/components/ui";
import { isPreviewableImagePath } from "../lib/previewable-image";
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
  const Icon = fileName && isPreviewableImagePath(fileName) ? Picture : Code;
  return (
    <BaseTab
      isActive={isActive}
      isFirst={isFirst}
      onClick={onClick}
      onClose={onClose}
      tooltip={fileName || "Editor"}
      icon={<Icon className="size-4 shrink-0 text-primary-800 dark:text-primary-200 hover:text-primary-900 dark:hover:text-primary-100 " />}
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
