import { Note } from "@/components/ui/icons";
import type { ReviewTab } from "@/lib/redux/slices/workspaceSlice";
import { BaseTab } from "./base-tab";

interface NoteTabProps {
  review: ReviewTab;
  isActive: boolean;
  isFirst?: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

export function NoteTab({ review, isActive, isFirst, onClick, onClose }: NoteTabProps) {
  return (
    <BaseTab
      isActive={isActive}
      isFirst={isFirst}
      onClick={onClick}
      onClose={onClose}
      icon={<Note className="w-4 h-4" />}
      label={review.title}
      tooltip={review.title}
    />
  );
}
