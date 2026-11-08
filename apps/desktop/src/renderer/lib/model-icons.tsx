import type { ComponentType, SVGProps } from "react";
import {
  Bot,
  CopilotStatic,
  Cursor,
  DeepSeek,
  Gemini,
  Gpt,
  Grok,
  Kimi,
  Meta,
  Muse,
  Zai,
} from "@/components/ui/icons";
import { Claude } from "@/components/ui/icons/space";
import type { ProviderVariant } from "./provider-variants";
import { cn } from "./cn";

/** Reserve one slot in every picker; balance each logo within it, without shifting labels. */
function modelIcon(Icon: ComponentType<SVGProps<SVGSVGElement>>, className?: string) {
  return (
    <span aria-hidden="true" className="inline-flex size-3.5 shrink-0 items-center justify-center align-middle leading-none">
      <Icon className={cn("block size-3.5 shrink-0", className)} />
    </span>
  );
}

export function getModelIcon(modelName: string, variant?: ProviderVariant) {
  const name = modelName.toLowerCase();
  if (name.includes("muse")) {
    return modelIcon(Muse);
  }
  if (name.includes("deepseek")) {
    return modelIcon(DeepSeek, "size-3.25");
  }
  if (name.includes("gpt")) {
    return modelIcon(Gpt, "size-3.25 dark:text-primary text-primary-950");
  }
  if (name.includes("llama")) {
    return modelIcon(Meta);
  }
  if (
    name.includes("opus") ||
    name.includes("sonnet") ||
    name.includes("haiku") ||
    name.includes("claude") ||
    name.includes("fable") ||
    name === "default" ||
    name.startsWith("default ")
  ) {
    return modelIcon(Claude, "text-claude");
  }
  if (name.includes("gemini")) {
    return modelIcon(Gemini);
  }
  if (name.includes("composer")) {
    return modelIcon(Cursor, "size-3.25 dark:text-primary text-primary-950");
  }
  if (name.includes("auto")) {
    if (variant === "copilot") {
      return modelIcon(CopilotStatic, "size-3.25 dark:text-primary text-primary-950");
    }
    return modelIcon(Cursor, "size-3.25 dark:text-primary text-primary-950");
  }
  if (name.includes("codex")) {
    return modelIcon(Gpt, "size-3.25 text-primary-950 dark:text-primary");
  }
  if (name.includes("grok")) {
    return modelIcon(Grok, "size-3.25 dark:text-primary text-primary-950");
  }
  if (name.includes("kimi")) {
    return modelIcon(Kimi, "-translate-x-px translate-y-px dark:text-primary text-primary-950");
  }
  if (name.includes("glm")) {
    return modelIcon(Zai, "scale-85 dark:text-primary text-primary-950");
  }
  return modelIcon(Bot, "dark:text-primary text-primary-950");
}
