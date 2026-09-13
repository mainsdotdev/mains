/**
 * Reading the chips back out of a sent prompt.
 *
 * A prompt is stored as plain text with the tokens the composer serialized —
 * `$<skill>`, `@<abs/path>`, `@<abs/path>#L19-24` — plus the structured
 * `skills` / `files` the run carried in its artifact metadata. Neither half is
 * enough alone: the text says *where* a chip goes, the metadata says what it
 * was. This is the phone's port of the desktop's `renderMessageWithChips`
 * (`components/tools/info-group.tsx`), split so the parse is testable on its
 * own and the components only draw.
 *
 * Same token grammar, same precedence — the alternatives are ordered skill,
 * code, file, because a code token *extends* a file path and the plain-path
 * alternative would otherwise win at the same `@` and strand the `#L…`.
 */

export interface PromptSkill {
  name: string;
  displayName?: string;
  shortDescription?: string;
  description?: string;
  /** A plugin's data/https URL, or an absolute path on the Mac; see `SkillSummary`. */
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
  scope?: string;
}

export interface PromptFile {
  fullPath: string;
  basename: string;
}

export type PromptSegment =
  | { kind: "text"; text: string }
  | { kind: "skill"; skill: PromptSkill }
  | { kind: "file"; file: PromptFile }
  /** `@/abs/path#L19-24` — self-describing, needs no metadata to render. */
  | { kind: "code"; path: string; range: string };

export interface PromptContent {
  segments: PromptSegment[];
  /**
   * Files carried in metadata that no token in the text pointed at — attached
   * from somewhere other than an inline mention. The bubble lists them under
   * the message, as the desktop does.
   */
  externalFiles: PromptFile[];
}

const REGEX_ESC = /[.*+?^${}()|[\]\\]/g;
const CODE_TOKEN_SRC = "@(?<code>\\/[^\\s#]+#L\\d+(?:-\\d+)?)(?![\\w-])";
const CODE_TOKEN_TEST = new RegExp(CODE_TOKEN_SRC);

/** Split a `metadata.files` entry into the shape a chip needs. */
export function promptFileFromPath(path: string): PromptFile {
  return { fullPath: path, basename: path.slice(path.lastIndexOf("/") + 1) };
}

export function parsePromptContent(
  message: string,
  skills: PromptSkill[],
  files: PromptFile[],
): PromptContent {
  const trimmed = message.trim();
  if (!trimmed) return { segments: [], externalFiles: files };

  const hasCodeToken = CODE_TOKEN_TEST.test(trimmed);
  if (skills.length === 0 && files.length === 0 && !hasCodeToken) {
    return { segments: [{ kind: "text", text: trimmed }], externalFiles: [] };
  }

  const skillByName = new Map(skills.map((s) => [s.name, s]));
  const fileByPath = new Map(files.map((f) => [f.fullPath, f]));

  // Longest-first, so `$review-pr` cannot be eaten by a shorter `$review`.
  const parts: string[] = [];
  if (skills.length > 0) {
    const names = skills
      .map((s) => s.name)
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(REGEX_ESC, "\\$&"));
    // The optional `:<name>` suffix absorbs a duplicated tail left by older
    // skill serializations, so a legacy run doesn't show the bare word.
    parts.push(`\\$(?<skill>${names.join("|")})(?::[\\w-]+)?(?![\\w-])`);
  }
  if (hasCodeToken) parts.push(CODE_TOKEN_SRC);
  if (files.length > 0) {
    const paths = files
      .map((f) => f.fullPath)
      .sort((a, b) => b.length - a.length)
      .map((p) => p.replace(REGEX_ESC, "\\$&"));
    parts.push(`@(?<file>${paths.join("|")})(?![\\w./-])`);
  }

  const re = new RegExp(parts.join("|"), "g");
  const segments: PromptSegment[] = [];
  const matchedPaths = new Set<string>();
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  const pushText = (text: string) => {
    if (text) segments.push({ kind: "text", text });
  };

  while ((match = re.exec(trimmed)) !== null) {
    pushText(trimmed.slice(lastIdx, match.index));

    const skillName = match.groups?.skill;
    const codeToken = match.groups?.code;
    const filePath = match.groups?.file;

    if (skillName) {
      const skill = skillByName.get(skillName);
      if (skill) segments.push({ kind: "skill", skill });
      else pushText(match[0]);
    } else if (codeToken) {
      const hashIdx = codeToken.lastIndexOf("#L");
      segments.push({
        kind: "code",
        path: codeToken.slice(0, hashIdx),
        range: codeToken.slice(hashIdx + 2),
      });
    } else if (filePath) {
      const file = fileByPath.get(filePath);
      if (file) {
        matchedPaths.add(filePath);
        segments.push({ kind: "file", file });
      } else {
        pushText(match[0]);
      }
    }

    lastIdx = match.index + match[0].length;
  }
  pushText(trimmed.slice(lastIdx));

  return {
    segments,
    externalFiles: files.filter((f) => !matchedPaths.has(f.fullPath)),
  };
}

/** Extension → SF Symbol. The phone's stand-in for the desktop's file-icon set. */
export function fileSymbol(basename: string): string {
  const dot = basename.lastIndexOf(".");
  const ext = dot > 0 ? basename.slice(dot + 1).toLowerCase() : "";
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "py":
    case "rb":
    case "go":
    case "rs":
    case "java":
    case "kt":
    case "swift":
    case "c":
    case "h":
    case "cpp":
    case "sh":
    case "css":
    case "html":
      return "chevron.left.forwardslash.chevron.right";
    case "json":
    case "yml":
    case "yaml":
    case "toml":
      return "curlybraces";
    case "md":
    case "mdx":
    case "txt":
      return "doc.text";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return "photo";
    case "pdf":
      return "doc.richtext";
    default:
      return "doc";
  }
}
