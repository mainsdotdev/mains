import type { ComposerAttachment } from "@/lib/composer-attachments";
import type { PromptSkill } from "@/lib/prompt-chips";

/** What the composer needs to offer its inline context menu. */
export interface ComposerContext {
  backendId: string;
  providerId: string;
  /** The run target's folder on the Mac, when there is one. */
  workspacePath?: string | null;
  /** Skills attached to the next send; the caller passes them to the Mac. */
  skills: PromptSkill[];
  onSkillsChange: (skills: PromptSkill[]) => void;
}

/** Window coordinates where a sent bubble should emerge from the text field. */
export interface ComposerSendOrigin {
  x: number;
  y: number;
  /** Window coordinates of image thumbnails, in composer order. */
  images: ComposerSendImageOrigin[];
}

export interface ComposerSendImageOrigin {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Window-space rectangle used while a prompt leaves the composer. */
export interface PromptBubbleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Measured bounds of a prompt and each independently flying surface in it. */
export interface PromptMessageRect extends PromptBubbleRect {
  text: PromptBubbleRect | null;
  images: PromptBubbleRect[];
}

export interface PromptFlightElement {
  from: PromptBubbleRect;
  to: PromptBubbleRect;
}

/** Source and destination coordinates relative to the RunView root. */
export interface PromptFlight {
  text: PromptFlightElement | null;
  images: PromptFlightElement[];
}

/** A prompt as it was sent, drawn before the Mac's own copy of it arrives. */
export interface PendingPrompt {
  /** The composed goal — what was typed plus a token per attached skill. */
  text: string;
  /** The exact string still visible in the text field at the handoff. */
  sourceText?: string;
  skills: PromptSkill[];
  /** Where the text sat in the composer when Send was pressed. */
  origin?: ComposerSendOrigin | null;
  /** Local sources keep image previews continuous until the Mac's copy arrives. */
  attachments?: ComposerAttachment[];
}
