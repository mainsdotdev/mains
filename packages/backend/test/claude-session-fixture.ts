import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Native SDK import only: no query, model request, credentials or user profile. */
export async function claudeSessionFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mains-session-mirror-")));
  const dir = join(root, "workspace"), configDir = join(root, "claude");
  const sessionId = randomUUID(), projectKey = dir.replace(/[^a-zA-Z0-9]/g, "-");
  const project = join(configDir, "projects", projectKey), file = join(project, `${sessionId}.jsonl`);
  const childDir = join(project, sessionId, "subagents");
  await mkdir(dir); await mkdir(childDir, { recursive: true });
  const main = [
    { type: "user", uuid: randomUUID(), sessionId, cwd: dir, parentUuid: null, message: { role: "user", content: "Private user prompt" } },
    { type: "assistant", uuid: randomUUID(), sessionId, message: { role: "assistant", content: [
      { type: "thinking", thinking: "Exact thinking", signature: "opaque-signed-thinking" },
      { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/private/path" } },
    ] } },
    { type: "user", uuid: randomUUID(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "Exact tool result" }] } },
    { type: "custom-title", customTitle: "Session title", sessionId },
    { type: "mode", value: "same-marker" }, { type: "mode", value: "same-marker" },
  ];
  const child = [{ type: "assistant", uuid: randomUUID(), message: { role: "assistant", content: "Subagent output" } }];
  const metadata = { agentId: "agent-review", agentType: "review", description: "Review child" };
  await writeFile(file, main.map((row) => JSON.stringify(row)).join("\n") + "\n");
  await writeFile(join(childDir, "agent-review.jsonl"), child.map((row) => JSON.stringify(row)).join("\n") + "\n");
  await writeFile(join(childDir, "agent-review.meta.json"), JSON.stringify(metadata));
  return { root, dir, configDir, sessionId, file, main, child: [...child, { type: "agent_metadata", ...metadata }],
    cleanup: () => rm(root, { recursive: true, force: true }) };
}
