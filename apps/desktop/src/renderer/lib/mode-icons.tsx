import type { SVGProps, ComponentType } from "react";
import type { ModeId } from "../../shared/modes";
import { Chat } from "@/components/ui/icons";
import { Bag, Code } from "@/components/ui/icons/space";

export type ModeIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** The glyph for each experience. Shared by the sidebar switcher and the command menu. */
export const MODE_ICONS: Record<ModeId, ModeIcon> = {
  developer: Code,
  work: Bag,
  chat: Chat,
};
