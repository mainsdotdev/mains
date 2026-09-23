import {
  CopilotStatic,
  Cursor,
  DeepSeek,
  Gemini,
  Gpt,
  Grok,
  Kimi,
  Mains,
  Meta,
  Zai,
} from "@/components/ui/icons";
import { Claude } from "@/components/ui/icons/space";
import type { ProviderVariant } from "./provider-variants";

export function getModelIcon(modelName: string, variant?: ProviderVariant) {
  const name = modelName.toLowerCase();
  if (name.includes("deepseek")) {
    return <DeepSeek className="size-3.5" />;
  }
  if (name.includes("gpt")) {
    return <Gpt className="size-3.5 dark:text-primary text-primary-950" />;
  }
  if (name.includes("llama")) {
    return <Meta className="size-3.5" />;
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
    return <Claude className="size-3.5 text-claude" />;
  }
  if (name.includes("gemini")) {
    return <Gemini className="size-3.5" />;
  }
  if (name.includes("composer")) {
    return <Cursor className="size-3.5 dark:text-primary text-primary-950" />;
  }
  if (name.includes("auto")) {
    if (variant === "copilot") {
      return <CopilotStatic className="size-3.5 dark:text-primary text-primary-950" />;
    }
    return <Cursor className="size-3.5 dark:text-primary text-primary-950" />;
  }
  if (name.includes("codex")) {
    return <Gpt className="size-3.5 text-primary-950 dark:text-primary" />;
  }
  if (name.includes("grok")) {
    return <Grok className="size-3.5 dark:text-primary text-primary-950" />;
  }
  if (name.includes("kimi")) {
    return <Kimi className="size-3.5 dark:text-primary text-primary-950" />;
  }
  if (name.includes("glm")) {
    return <Zai className="size-3.5 dark:text-primary text-primary-950" />;
  }
  // Default icon
  return <Mains className="size-3.5 dark:text-primary text-primary-950" />;
}
