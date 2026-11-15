import { Button } from "@/components/ui";
import type { AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { AssistantAvatar } from "./assistant-avatar";
import { cn } from "@/lib/cn";

export function AssistantMonogram({ name, avatar, working = false, size = "sm", onClick }: {
  name: string;
  avatar?: Avatar;
  providerId: string;
  working?: boolean;
  size?: "sm" | "lg";
  onClick(): void;
}) {
  return (
    <Button variant="bare" aria-label={`About ${name}`} tooltip="Assistant information" onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center font-medium text-primary-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent dark:text-primary-100",
        size === "lg" ? "mx-auto mb-4 size-12 rounded-2xl text-xl" : "size-8 rounded-xl text-sm",
      )}>
      <AssistantAvatar avatar={avatar} working={working} seed={name} className="size-full" />
    </Button>
  );
}
