import type { ContextSkill } from "./composer-context";

type SkillDestination =
  | { kind: "plugin"; pluginId: string }
  | { kind: "document"; path: string };

export function composerSkillDestination(skill: ContextSkill): SkillDestination | null {
  if (skill.scope === "computer") return null;
  if (skill.mentionPath?.startsWith("plugin://")) {
    const pluginId = skill.mentionPath.slice("plugin://".length);
    return pluginId ? { kind: "plugin", pluginId } : null;
  }
  if (skill.path && /(?:^|[/\\])SKILL\.md$/i.test(skill.path)) {
    return { kind: "document", path: skill.path };
  }
  return null;
}
