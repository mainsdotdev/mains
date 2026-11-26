import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import type { AssistantSkill, AssistantSkillDraft } from "@mains/contracts/assistants";
import { getBackendRuntime } from "../../runtime/backend-runtime";
import { providersService } from "../providers";
import { parseSimpleYaml } from "../providers/skill-frontmatter";
import { object, onlyKeys, text } from "./assistants.validation";

const MAX_SKILL_BYTES = 64 * 1024;
const SKILL_ID = /^[a-f0-9]{64}$/;
const hash = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const localSkillId = (accountId: string, name: string) => hash("local-skill", accountId, name);
const libraryDir = (accountId: string) => path.join(getBackendRuntime().getPath("userData"), "skills", hash(accountId));

export function skillTitle(name: string): string {
    const label = name.split(":").at(-1)?.replace(/[-_]+/g, " ").trim() || name;
    return label.charAt(0).toUpperCase() + label.slice(1);
}

export function validateSkillDraft(input: unknown): AssistantSkillDraft {
    const draft = object(input);
    onlyKeys(draft, ["name", "title", "description", "markdown", "examplePrompt"]);
    const name = text(draft.name, "Skill name", 64);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("Use lowercase letters, digits, and single hyphens in the skill name.");
    const examplePrompt = text(draft.examplePrompt, "Example prompt", 1000, true);
    return { name, title: text(draft.title, "Skill title", 100), description: text(draft.description, "Description", 1024),
        markdown: text(draft.markdown, "Skill instructions", MAX_SKILL_BYTES), ...(examplePrompt && { examplePrompt }) };
}

export function parseSkillDocument(document: unknown): AssistantSkillDraft {
    if (typeof document !== "string" || Buffer.byteLength(document) > MAX_SKILL_BYTES) throw new Error("Choose a SKILL.md file up to 64 KB.");
    const header = /^\uFEFF?---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/.exec(document);
    if (!header) throw new Error("SKILL.md needs YAML frontmatter with a name and description.");
    const fields = parseSimpleYaml(header[1]);
    const markdown = document.slice(header[0].length);
    const heading = /^# +(.+)$/m.exec(markdown)?.[1];
    return validateSkillDraft({ name: fields.name, title: fields.title ?? heading ?? skillTitle(String(fields.name ?? "")),
        description: fields.description, markdown, examplePrompt: fields["example-prompt"] });
}

export async function saveLocalSkill(accountId: string, draft: AssistantSkillDraft): Promise<AssistantSkill> {
    const { name, title, description, markdown, examplePrompt } = validateSkillDraft(draft);
    const id = localSkillId(accountId, name);
    const document = ["---", `name: ${name}`, `title: ${JSON.stringify(title)}`, `description: ${JSON.stringify(description)}`,
        ...(examplePrompt ? [`example-prompt: ${JSON.stringify(examplePrompt)}`] : []), "---", "", markdown, ""].join("\n");
    if (Buffer.byteLength(document) > MAX_SKILL_BYTES) throw new Error("A skill document must be 64 KB or smaller.");
    const directory = path.join(libraryDir(accountId), id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const pending = path.join(directory, `${randomUUID()}.tmp`);
    const target = path.join(directory, "SKILL.md");
    try {
        await fs.writeFile(pending, document, { flag: "wx", mode: 0o600 });
        await fs.link(pending, target);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await readAssistantSkillDocument(target) !== document) throw new Error("A local skill already uses this name. Choose another name.");
    } finally {
        await fs.unlink(pending).catch(() => {});
    }
    return { id, name: title, description, storage: "local" };
}

export async function readLocalSkill(accountId: string, id: string) {
    if (!SKILL_ID.test(id)) return null;
    const filePath = path.join(libraryDir(accountId), id, "SKILL.md");
    let document: string;
    try { document = await readAssistantSkillDocument(filePath); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    const draft = parseSkillDocument(document);
    if (localSkillId(accountId, draft.name) !== id) throw new Error("This local skill no longer matches its saved name.");
    const skill: AssistantSkill = { id, name: draft.title, description: draft.description, storage: "local" };
    return { skill, path: filePath, document };
}

async function listLocalSkills(accountId: string) {
    const dirs = await fs.readdir(libraryDir(accountId), { withFileTypes: true }).catch(error => {
        if (error.code === "ENOENT") return [];
        throw error;
    });
    const results = await Promise.allSettled(dirs.filter(dir => dir.isDirectory()).map(dir => readLocalSkill(accountId, dir.name)));
    return results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
}

/** The provider catalog supplies paths. Clients and tool calls use opaque IDs. */
export async function assistantSkillCatalog(accountId: string, providerId: string) {
    const [local, skills] = await Promise.all([listLocalSkills(accountId), providersService.getSkills(providerId).catch(() => [])]);
    const entries = new Map<string, { skill: AssistantSkill; path: string }>(local.map(entry => [entry.skill.id, entry]));
    const pluginSkillIds: string[] = [];
    for (const candidate of skills) {
        const source = candidate.mentionPath ?? candidate.path;
        const id = source && hash(providerId, candidate.name, source);
        if (candidate.pluginId || candidate.scope === "plugin") {
            if (id) pluginSkillIds.push(id);
            continue;
        }
        if (!candidate.path || candidate.enabled === false || candidate.modelInvocable === false ||
            !path.isAbsolute(candidate.path) || path.basename(candidate.path).toLowerCase() !== "skill.md") continue;
        const resolved = await fs.realpath(candidate.path).catch(() => null);
        if (!resolved || path.basename(resolved).toLowerCase() !== "skill.md") continue;
        const info = await fs.stat(resolved).catch(() => null);
        if (!info?.isFile() || info.size > MAX_SKILL_BYTES) continue;
        if (!id) continue;
        entries.set(id, {
            path: resolved,
            skill: { id, name: (candidate.displayName || skillTitle(candidate.name)).slice(0, 200), description: (candidate.description || "").slice(0, 1024) },
        });
    }
    return { entries, pluginSkillIds };
}

export async function readAssistantSkillDocument(filePath: string) {
    const file = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const info = await file.stat();
        if (!info.isFile() || info.size > MAX_SKILL_BYTES) throw new Error("This skill document is unavailable or too large.");
        const buffer = Buffer.alloc(MAX_SKILL_BYTES + 1);
        let offset = 0;
        while (offset < buffer.length) {
            const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
            if (!bytesRead) break;
            offset += bytesRead;
        }
        if (offset > MAX_SKILL_BYTES) throw new Error("This skill document is too large.");
        return buffer.toString("utf8", 0, offset);
    } finally {
        await file.close();
    }
}
