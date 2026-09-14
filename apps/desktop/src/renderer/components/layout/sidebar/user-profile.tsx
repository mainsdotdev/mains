import { Body, Text } from "@/components/ui";
import { proxiedImageSrc } from "@/lib/proxied-image-src";

interface UserProfileProps {
  avatarUrl?: string;
  displayName?: string;
  isVisible: boolean;
}

const getInitials = (name: string) => {
  if (!name) return "U";
  const parts = name.trim().split(" ");
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

export default function UserProfile({
  avatarUrl,
  displayName,
  isVisible,
}: UserProfileProps) {
  return (
    <div
      className={`flex items-center gap-2 transition-all duration-300 ease-in-out  ${
        isVisible
          ? "opacity-100 flex-1 scale-100"
          : "opacity-0 w-0 scale-95 pointer-events-none"
      }`}
    >
      {avatarUrl ? (
        <img
          src={proxiedImageSrc(avatarUrl) ?? avatarUrl}
          alt={displayName || "Mains"}
          className="size-6 rounded-full object-cover ml-2"
        />
      ) : (
        <div className="size-6 rounded-full bg-primary/20 dark:bg-primary/5 flex items-center justify-center ml-1">
          <Text as="span" size="t">
            {getInitials(displayName || "")}
          </Text>
        </div>
      )}
      <Body weight="medium" className="truncate whitespace-nowrap">
        {displayName || "Mains"}
      </Body>
    </div>
  );
}
