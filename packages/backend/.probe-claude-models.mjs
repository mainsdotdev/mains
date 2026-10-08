import { query } from "@anthropic-ai/claude-agent-sdk";
const q = query({ prompt: "", options: {} });
try {
  const models = await q.supportedModels();
  for (const m of models) console.log(m.value, "|", m.displayName);
  const seen = {}; for (const m of models) seen[m.value] = (seen[m.value] ?? 0) + 1;
  console.log("dupes:", Object.entries(seen).filter(([, n]) => n > 1));
} finally { q.close(); }
