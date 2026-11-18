import { Button } from "@/components/ui";
import { isAssistantRobotShape, type AssistantAvatar as Avatar } from "@mains/contracts/assistants";
import { AssistantAvatar } from "./assistant-avatar";
import { AssistantRobotPreview } from "./assistant-robot-avatar";
import { cn } from "@/lib/cn";

const sizeClasses = {
  sm: "size-8 rounded-xl text-sm",
  lg: "mx-auto mb-4 size-12 rounded-2xl text-xl",
  xl: "size-15 rounded-xl text-base",
};

export function AssistantMonogram({ name, avatar, working = false, size = "sm", welcome = false, onClick }: {
  name: string;
  avatar?: Avatar;
  providerId: string;
  working?: boolean;
  size?: keyof typeof sizeClasses;
  welcome?: boolean;
  onClick(): void;
}) {
  const shape = avatar?.shape;
  return (
    <Button variant="bare" aria-label={`About ${name}`} tooltip="Mate information" onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center font-medium text-primary-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent dark:text-primary-100",
        sizeClasses[size],
      )}>
      {welcome && isAssistantRobotShape(shape)
        ? <AssistantRobotPreview shape={shape} presentation="welcome" className="size-full" />
        : <AssistantAvatar avatar={avatar} working={working} seed={name} className="size-full" />}
    </Button>
  );
}
