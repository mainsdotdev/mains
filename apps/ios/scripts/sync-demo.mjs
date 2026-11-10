// Only consumes the already-sanitized, checked-in Expo fixture. No desktop DB,
// credential store, provider, network or real workspace is accessed.
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const source = new URL('../../mobile/src/backend/demo/demo-snapshot.json', import.meta.url);
const seed = JSON.parse(fs.readFileSync(source, 'utf8'));
const model = (id, displayName, description, levels, isDefault = false) => ({
  id, displayName, description, isDefault,
  ...(levels ? { supportedEffortLevels: levels } : {}),
});
seed.models = {
  codex: [
    model('gpt-6.1-sol', 'GPT 6.1 Sol', 'For coding and everyday work.', ['low','medium','high','xhigh','max','ultra'], true),
    model('gpt-6-astra', 'GPT 6 Astra', 'For your most demanding tasks.', ['low','medium','high','xhigh','max','ultra']),
    model('gpt-6.1-terra', 'GPT 6.1 Terra', 'For focused coding tasks.', ['low','medium','high','xhigh','max','ultra']),
    model('gpt-6-sol', 'GPT 6 Sol', 'Previous generation workhorse.', ['low','medium','high','xhigh','max','ultra']),
    model('gpt-6-luna', 'GPT 6 Luna', 'Fast answers for simpler tasks.', ['low','medium','high','xhigh','max']),
  ].map(m => ({ ...m, serviceTiers: [{ id:'fast', name:'Fast', description:'Prioritize response speed.' }] })),
  claude_code: [
    model('sonnet', 'Sonnet 5.5', 'For everyday work and routine tasks.', ['low','medium','high','xhigh','max'], true),
    model('opus', 'Opus 5.5', 'For complex work and deeper reasoning.', ['low','medium','high','xhigh','max']),
    model('fable', 'Fable 5.2', 'For your toughest challenges.', ['low','medium','high','xhigh','max']),
    model('haiku', 'Haiku 5.5', 'Fast answers for simpler tasks.'),
  ],
  copilot_cli: [model('auto', 'Auto', 'Let Copilot choose a model.', undefined, true)],
  cursor: [
    model('default', 'Auto', 'Let Cursor choose a model.', undefined, true),
    model('claude-opus-4-8', 'Claude Opus 4.8', 'For complex coding tasks.', ['','high']),
    model('gpt-6.1-sol', 'GPT 6.1 Sol', 'For coding and everyday work.', ['low','medium','high','xhigh','max']),
  ],
  opencode: [
    model('demo/sonnet', 'Sonnet 5.5', 'For everyday coding tasks.', ['low','medium','high'], true),
    model('demo/gpt-6.1-sol', 'GPT 6.1 Sol', 'For coding and everyday work.', ['low','medium','high','xhigh','max']),
  ],
};
seed.spaces.push({ id:'opencode', name:'OpenCode', slug:'opencode', icon:'icon:opencode', providerId:'opencode', mode:'developer', sortOrder:4, isArchived:false });
seed.providers.push({ id:'opencode', displayName:'OpenCode', isEnabled:true, config:{ agent:'build', effortLevel:'medium' } });
for (const space of seed.spaces) space.model = seed.models[space.providerId][0].id;
for (const run of seed.runs) {
  run.model = seed.models[run.providerId][0].id;
  if (run.configSnapshot?.conversationSettings) run.configSnapshot.conversationSettings.model = run.model;
  for (const turn of seed.turns[run.id] ?? []) turn.model = run.model;
}
for (const collection of seed.collections) {
  collection.icon = collection.icon?.replace('|purple','|violet').replace('icon:earth','icon:world');
}
const icons = { mains:'icon:mains|olive', docs:'icon:notebook|amber', website:'icon:compass|violet', home:'icon:folder|green' };
for (const project of seed.projects) project.icon = icons[project.name] ?? project.icon;
// Channels not consumed by native iOS remain out of its bundled resource.
for (const key of ['skills','commands','diffSummaries']) delete seed[key];
seed.nativeDemoVersion = 1;
const output = new URL('Sources/MainsCore/Resources/DemoSnapshot.json', root);
const content = JSON.stringify(seed) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output,'utf8') !== content) throw new Error('Run node scripts/sync-demo.mjs');
  console.log('Verified native demo fixture against the Expo source');
} else {
  fs.mkdirSync(new URL('./',output),{recursive:true});
  fs.writeFileSync(output,content);
  console.log('Generated native demo fixture from the Expo source');
}
