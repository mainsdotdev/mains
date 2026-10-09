import type { SkillInfo } from "@/lib/redux/api/providersApi";
import type { ContextSkillItem } from "@/features/workspace/lib/composer-context";

export const IMAGE_TEMPLATES = [
  { title: "Poster", prompt: "Create a poster with clear hierarchy, readable text, and imagery that fits my idea. Preserve supplied names, dates, and details exactly. Ask me about the message, required content, layout, and visual style before generating.\n\nMy idea: " },
  { title: "Interior design", prompt: "Create an interior design visualization for my space. Ask me about the room, dimensions, style, colors, and furniture. Preserve the layout and architectural details in any reference photo.\n\nMy space: " },
  { title: "Logo", prompt: "Design a distinctive, simple logo for my brand. Ask me about the brand name, audience, personality, preferred colors, and where the logo will be used.\n\nMy brand: " },
  { title: "Illustration", prompt: "Create an illustration of my idea. Ask me about the subject, composition, mood, colors, and illustration style.\n\nMy idea: " },
  { title: "Headshot", prompt: "Create a professional headshot from my reference photo, preserving my identity and natural features. Ask me about the background, clothing, lighting, and intended use.\n\nMy preferences: " },
  { title: "Icon", prompt: "Design an icon that stays clear at small sizes. Ask me about its meaning, visual style, colors, background, and intended size.\n\nMy icon: " },
  { title: "Product photo", prompt: "Create a polished product photo, preserving the product's shape, materials, branding, and supplied details. Ask me about the setting, lighting, composition, and intended use.\n\nMy product: " },
  { title: "T-shirt", prompt: "Create an original T-shirt design. Ask me about the subject, required text, style, colors, and shirt color. Keep the design suitable for printing.\n\nMy idea: " },
  { title: "Infographic", prompt: "Create a clear infographic using the information I provide. Preserve all facts and numbers; ask me for missing content, audience, layout, and visual style.\n\nMy information: " },
  { title: "Comic", prompt: "Create a comic from my story. Ask me about the characters, plot, dialogue, number of panels, and art style. Keep characters consistent across panels.\n\nMy story: " },
  { title: "Book cover", prompt: "Design a book cover with readable typography and imagery that fits the story. Ask me about the title, author, genre, audience, format, and visual direction.\n\nMy book: " },
] as const;

export function isImageGenAvailable(skill?: SkillInfo): skill is SkillInfo {
  return !!skill && skill.enabled !== false && skill.userInvokable !== false;
}

export function findImageGenSkill(skills?: readonly SkillInfo[]): SkillInfo | undefined {
  const matches = skills?.filter((skill) =>
    [skill.name, skill.displayName].some((name) =>
      ["imagegen", "imagegeneration"].includes((name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")),
    ),
  );
  return matches?.find(isImageGenAvailable) ?? matches?.[0];
}

export function imageGenContext(skill: SkillInfo): ContextSkillItem {
  return {
    kind: "skill", name: skill.name, path: skill.path, mentionPath: skill.mentionPath, scope: skill.scope,
    displayName: skill.displayName || skill.name,
    description: skill.description,
    shortDescription: skill.shortDescription,
    iconSmall: skill.iconSmall,
    iconLarge: skill.iconLarge,
    brandColor: skill.brandColor,
  };
}

export function imagePrompt(prompt: string, skill?: SkillInfo): string {
  return skill ? `$${skill.name} ${prompt}` : prompt;
}

export function hasImageInstruction(prompt: string, skill?: SkillInfo): boolean {
  const token = skill ? `$${skill.name}` : "";
  return !!(token ? prompt.split(token).join("") : prompt).trim();
}
