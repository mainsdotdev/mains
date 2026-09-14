import type { CommandRow, SkillRow } from "@/db/schema";

import type { PromptSkill } from "./prompt-chips";

/**
 * What the composer's `@` / `/` / `$` menu offers, and how it is sorted into
 * sections — the phone's port of `unified-context-dropdown.tsx`'s pure half:
 * `bucketSkill`, the per-bucket filter, and `buildSections`.
 *
 * Two of the desktop's four sources are missing here on purpose. Files need
 * `fileExplorer:*` and issues need `issues:*`; neither is on the paired-device
 * channel allowlist, and opening a phone onto the Mac's filesystem is a bigger
 * decision than a picker. So `@` and `/` both resolve to skills + commands.
 */

/** `@` and `/` open everything; `$` narrows to skills. */
export type ContextTrigger = "@" | "/" | "$";

/** Restricts the menu to one bucket — what the composer's "+" button opens. */
export type ContextBucket = "plugins";

export interface TriggerMatch {
  trigger: ContextTrigger;
  /** Text typed after the trigger, used to filter. */
  filter: string;
  /** Index of the trigger character in the message. */
  start: number;
}

/**
 * The trigger token at the end of the message, if any.
 *
 * The desktop watches the caret so a mention can be inserted mid-sentence; a
 * phone keyboard puts the caret at the end essentially always, and the desktop
 * keeps this exact trailing-match as its own fallback for when the dropdown
 * steals focus. Same boundary rule: start of text, or whitespace before.
 */
export function detectTrigger(message: string): TriggerMatch | null {
  const match = /(?:^|\s)([/@$])(\S*)$/.exec(message);
  if (!match) return null;
  return {
    trigger: match[1] as ContextTrigger,
    filter: match[2],
    start: match.index + match[0].length - match[1].length - match[2].length,
  };
}

/**
 * Replace the detected token with `replacement`, leaving one trailing space —
 * or nothing at all when the token is simply being dropped.
 */
export function replaceTrigger(
  message: string,
  match: TriggerMatch,
  replacement: string,
): string {
  const head = message.slice(0, match.start);
  const tail = message.slice(match.start + 1 + match.filter.length).replace(/^\s+/, "");
  if (!replacement) return (head + tail).replace(/\s{2,}/g, " ");
  return `${head}${replacement} ${tail}`;
}

/** Which section a skill belongs to; null for ones a picker never lists. */
export function bucketSkill(skill: SkillRow): "plugins" | "mac_apps" | "skills" {
  const scope = (skill.scope ?? "").toLowerCase();
  if (scope === "plugin") return "plugins";
  if (scope === "mac" || scope === "mac_app" || scope === "computer") return "mac_apps";
  return "skills";
}

/** The badge the desktop shows on the right of a skill row. */
export function scopeLabel(scope: string | null): string {
  switch (scope) {
    case "user":
      return "User";
    case "project":
    case "repo":
      return "Project";
    case "system":
      return "System";
    case "plugin":
      return "Plugin";
    default:
      return "";
  }
}

export type PickerRow =
  | { kind: "skill"; skill: SkillRow }
  | { kind: "command"; command: CommandRow };

export interface PickerSection {
  title: string;
  rows: PickerRow[];
}

function matchesSkill(skill: SkillRow, needle: string): boolean {
  if (!needle) return true;
  return (
    skill.name.toLowerCase().includes(needle) ||
    (skill.displayName?.toLowerCase().includes(needle) ?? false) ||
    (skill.shortDescription?.toLowerCase().includes(needle) ?? false) ||
    (skill.description?.toLowerCase().includes(needle) ?? false)
  );
}

function matchesCommand(command: CommandRow, needle: string): boolean {
  if (!needle) return true;
  return (
    command.name.toLowerCase().includes(needle) ||
    (command.description?.toLowerCase().includes(needle) ?? false)
  );
}

export function buildPickerSections({
  skills,
  commands,
  trigger,
  bucket = null,
  filter,
}: {
  skills: SkillRow[];
  commands: CommandRow[];
  trigger: ContextTrigger;
  bucket?: ContextBucket | null;
  filter: string;
}): PickerSection[] {
  const pluginsOnly = bucket === "plugins";
  const needle = filter.toLowerCase();
  const wantsCommands = !pluginsOnly && (trigger === "@" || trigger === "/");

  const plugins: SkillRow[] = [];
  const macApps: SkillRow[] = [];
  const rest: SkillRow[] = [];
  for (const skill of skills) {
    if (!matchesSkill(skill, needle)) continue;
    const target =
      bucketSkill(skill) === "plugins" ? plugins : bucketSkill(skill) === "mac_apps" ? macApps : rest;
    target.push(skill);
  }

  const sections: PickerSection[] = [];
  const push = (title: string, rows: PickerRow[]) => {
    if (rows.length > 0) sections.push({ title, rows });
  };

  push("Plugins", plugins.map((skill) => ({ kind: "skill" as const, skill })));
  if (!pluginsOnly) {
    push("Mac apps", macApps.map((skill) => ({ kind: "skill" as const, skill })));
    push("Skills", rest.map((skill) => ({ kind: "skill" as const, skill })));
  }
  if (wantsCommands) {
    push(
      "Commands",
      commands
        .filter((command) => matchesCommand(command, needle))
        .map((command) => ({ kind: "command" as const, command })),
    );
  }
  return sections;
}

/**
 * An invisible marker riding on an inserted mention.
 *
 * The input holds a skill by its *label* — "Show Linear and Gmail" reads the
 * way the sentence was meant, where a raw "$linear" did not and an off-to-the-
 * side chip lost the position entirely (attach, type "and", attach again, and
 * the text said "Show and"). But a bare label is ambiguous: the word may be one
 * the user typed themselves. U+2063 INVISIBLE SEPARATOR rides along to say
 * "this occurrence is the mention" — it renders as nothing, and if the user
 * edits it away the mention simply stops being one.
 */
const MENTION_MARK = "\u2063";

/** What goes into the input when a skill is picked. */
export function skillMention(skill: PromptSkill): string {
  return `${skill.displayName || skill.name}${MENTION_MARK}`;
}

/** Drop a skill's mention from the text, marker and all. */
export function removeMention(message: string, skill: PromptSkill): string {
  const mention = skillMention(skill);
  const at = message.indexOf(mention);
  if (at === -1) return message;
  return (message.slice(0, at) + message.slice(at + mention.length))
    .replace(/\s{2,}/g, " ")
    .trimStart();
}

/**
 * Which of the picked skills are still attached.
 *
 * The text is the record: deleting a mention detaches it, the way deleting one
 * does in any composer that draws mentions inline. Nothing else tracks it, so
 * nothing else can fall out of step with what the user is looking at.
 */
export function attachedSkills(message: string, skills: PromptSkill[]): PromptSkill[] {
  return skills.filter((skill) => message.includes(skillMention(skill)));
}

/**
 * The message actually sent: every mention swapped back to its `$name` token.
 *
 * The token has to reach the wire — the transcript's chips are drawn by
 * matching it against the prompt's `skills` metadata — but it never had to be
 * what the user looked at.
 */
export function composeGoal(message: string, skills: PromptSkill[]): string {
  let out = message;
  for (const skill of skills) {
    const mention = skillMention(skill);
    const at = out.indexOf(mention);
    if (at === -1) continue;
    out = out.slice(0, at) + `$${skill.name}` + out.slice(at + mention.length);
  }
  // Any marker left over belonged to a skill that is no longer in the list.
  return out.split(MENTION_MARK).join("").trim();
}

/**
 * A picked skill, in the shape both halves of the round trip expect: the
 * `contextSkills` the Mac is sent, and the chips the prompt comes back with.
 */
export function skillContext(skill: SkillRow): PromptSkill & { path?: string } {
  return {
    name: skill.name,
    displayName: skill.displayName ?? undefined,
    description: skill.description ?? undefined,
    shortDescription: skill.shortDescription ?? undefined,
    iconSmall: skill.iconSmall ?? undefined,
    iconLarge: skill.iconLarge ?? undefined,
    brandColor: skill.brandColor ?? undefined,
    scope: skill.scope ?? undefined,
    path: skill.path ?? undefined,
  };
}
