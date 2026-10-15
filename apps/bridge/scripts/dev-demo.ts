import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CHANNELS } from "@mains/contracts/channels";
import { startLocalBackends } from "../test/local-backends";

// A disposable local demo: real hosts and Worker, no user database or provider execution.
const demo = await startLocalBackends();
let stopping = false, sourceStopped = false;
const input = createInterface({ input: process.stdin, output: process.stdout });
async function stop() {
  if (stopping) return; stopping = true; input.close(); await demo.dispose();
}
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
try {
  const { a, b } = demo;
  const account = await a.client.call(CHANNELS.account.get);
  const space = await a.client.call(CHANNELS.space.create, { name: "Bridge demo", providerId: "codex", mode: "developer" });
  const root = join(a.dir, "demo-project"); await mkdir(root);
  const project = await a.client.call(CHANNELS.projects.create, { accountId: account.id, rootPath: root, name: "Sync demo" });
  const workspace = await a.client.call(CHANNELS.workspace.create, { accountId: account.id, rootPath: root, name: "Source workspace", projectId: project.id });
  const runId = randomUUID();
  await a.client.call(CHANNELS.runs.create, { id: runId, accountId: account.id, workspaceId: workspace.id, spaceId: space.id, providerId: "codex", mode: "developer", title: "Hello from Computer A", status: "succeeded" });
  let turn = 0;
  const reply = async (text: string) => {
    await a.client.call(CHANNELS.runArtifacts.add, { runId, kind: "report", content: text, metadata: { turnIndex: turn++ } });
    await a.client.call(CHANNELS.bridge.syncNow);
  };
  await reply("This conversation lives on Computer A. Computer B keeps its own encrypted-sync replica.");
  const imageDirectory = join(a.dir, "generated-images", runId); await mkdir(imageDirectory, { recursive: true });
  const image = join(imageDirectory, "bridge-demo.svg");
  await writeFile(image, '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" rx="28" fill="#eeebfa"/><text x="60" y="140" font-family="sans-serif" font-size="60" fill="#30264e">A → B</text><text x="60" y="220" font-family="sans-serif" font-size="28" fill="#514164">This image travelled through encrypted Bridge blobs.</text><text x="60" y="275" font-family="sans-serif" font-size="24" fill="#514164">Stop A, then open the image on B.</text></svg>');
  await a.client.call(CHANNELS.runArtifacts.add, { runId, kind: "image", path: image, metadata: { path: image, fileName: "bridge-demo.svg", turnIndex: 0 } });
  await a.client.call(CHANNELS.bridge.syncNow);
  await b.client.call(CHANNELS.bridge.syncNow);
  for (const host of [a, b]) await host.client.call(CHANNELS.appSettings.update, { activeSpaceId: space.id });
  console.log(`Temporary profiles: ${demo.dir}`);
  console.log(`A (control): ${await a.webLogin()}`);
  console.log(`B (view replica): ${await b.webLogin()}`);
  console.log(`Run: ${runId}`);
  console.log("Type a message to persist it on A; B's open transcript updates. 'offline' stops A; 'online' restarts it; 'quit' cleans up.");
  console.log("For an Electron source: type 'desktop', then start apps/desktop with the printed isolated-profile command.");
  for await (const line of input) {
    const value = line.trim();
    if (stopping || value === "quit") break;
    if (value === "offline" || value === "desktop") {
      await a.stop(); sourceStopped = true;
      if (value === "desktop") {
        const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
        console.log(`From apps/desktop: MAINS_DEV_USER_DATA=${quote(a.dir)} MAINS_BRIDGE_CONFIG=${quote(a.configFile)} npm start`);
        console.log("Stop Electron before typing 'online' or 'quit'. Only one process may own A's database.");
      } else console.log("A is offline. B can read the transcript and open the synced image.");
    } else if (value === "online") {
      if (sourceStopped) { await a.start(); sourceStopped = false; }
      console.log("A is online.");
    } else if (value && !sourceStopped) { await reply(value); console.log("Saved on A."); }
  }
} finally { await stop(); }
