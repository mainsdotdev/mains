// Deterministic protocol fixture. Uses the REAL TypeScript codec and channels;
// never starts an AI provider, opens a real database, or edits a workspace.
import http from 'node:http';
import { createRequire } from 'node:module';
import { encodeWsMessage, decodeWsMessage, WS_PROTOCOL_VERSION } from '../../../packages/contracts/src/ws-protocol.ts';
import { CHANNELS } from '../../../packages/contracts/src/channels.ts';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { WebSocketServer, WebSocket } = require('ws');
const port = Number(process.env.MAINS_FIXTURE_PORT ?? 18787);
const descriptor = { backendId: 'ios-fixture', name: 'Test Mac', appVersion: '0.1.0', protocolVersion: WS_PROTOCOL_VERSION,
  capabilities: ['runs', 'space', 'workspace'], serverTime: new Date().toISOString() };
const connections = new Set(), receipts = new Map(), observations = [];
const timers = new Set(), replies = new Map();
const pendingDecisions = new Map();
const storedTurns = new Map(), storedDiffs = new Map();
let acceptsConnections = true;
let holdSnapshot = 0;
let contextDelayMs = 0, contextInvalidRows = false;
let pagedHistory = false;
let disjointHistory = false;
let artifacts, runs, nextID, spaces, tools;
function reset(longHistory = false, home = false, design = false, workspaceList = false, media = false, paging = false, disjoint = false) {
  for (const timer of timers) clearTimeout(timer);
  timers.clear(); replies.clear(); acceptsConnections = true;
  holdSnapshot = 0; contextDelayMs = 0; contextInvalidRows = false;
  pagedHistory = paging;
  disjointHistory = disjoint;
  receipts.clear(); pendingDecisions.clear(); storedTurns.clear(); storedDiffs.clear(); observations.length = 0; nextID = 10;
  tools = new Map();
  spaces = [{ id: 'fixture-space', name: 'Codex', providerId: 'codex', icon: 'icon:codex', mode: 'chat', model: null, isArchived: false },
    { id: 'fixture-code', name: 'Code', providerId: 'codex', icon: 'icon:codex', mode: 'developer', model: null, isArchived: false }];
  if (home) spaces.push(
    { id: 'fixture-claude', name: 'Claude', providerId: 'claude_code', icon: 'icon:claude', mode: 'developer', model: null, isArchived: false },
    { id: 'fixture-copilot', name: 'Copilot', providerId: 'copilot_cli', icon: 'icon:copilot', mode: 'developer', model: null, isArchived: false },
    { id: 'fixture-cursor', name: 'Cursor', providerId: 'cursor', icon: 'icon:cursor', mode: 'developer', model: null, isArchived: false });
  const date = new Date('2026-11-09T09:00:00Z');
  runs = [{ id: 'fixture-run', accountId: 'fixture-account', providerId: 'codex', mode: 'chat', spaceId: 'fixture-space',
    title: 'Native iOS conversation', status: 'succeeded', model: null, isArchived: false, isReplica: false,
    lastError: null, createdAt: date, updatedAt: date }];
  artifacts = new Map([['fixture-run', [
    { id: 1, runId: 'fixture-run', kind: 'user-prompt', content: 'A conversation from my computer', metadata: { source: 'user' }, createdAt: date },
    { id: 2, runId: 'fixture-run', kind: 'report', content: 'Hello from the computer.', metadata: { streamId: 'initial' }, createdAt: new Date(date.getTime() + 1000) },
  ]]]);
  if (home) {
    for (const mode of ['work', 'chat']) {
      const id = `fixture-${mode}`, at = new Date(Date.now() - 60000);
      runs.push({ ...runs[0], id, providerId: 'claude_code', spaceId: 'fixture-claude', mode,
        title: mode === 'work' ? 'Work planning' : 'Everyday chat', createdAt: at, updatedAt: at });
      artifacts.set(id, []);
    }
  }
  if (longHistory) {
    const items = [];
    for (let index = 0; index < (paging ? 24 : 12); index++) {
      const at = new Date(date.getTime() + index * 2000);
      items.push({ id: index * 2 + 1, runId: 'fixture-run', kind: 'user-prompt', content: `Earlier note ${index + 1}: How should we approach the next iteration?`, metadata: { source: 'user' }, createdAt: at });
      items.push({ id: index * 2 + 2, runId: 'fixture-run', kind: 'report', content: index === 11
        ? 'Let’s build one complete experience at a time.\n\n**Start with the conversation.** Keep the input responsive, make delivery clear, and let people read at their own pace.\n\n```swift\nlet nextStep = "Build, use, refine"\n```\n\nThen bring the same care to the next feature.'
        : 'Keep the scope focused on one useful flow. Design its states together with the behavior, then try it on a real device.\n\nSmall, complete steps are easier to evaluate and keep moving.', metadata: { streamId: `earlier-${index}` }, createdAt: new Date(at.getTime() + 1000) });
    }
    artifacts.set('fixture-run', items); nextID = paging ? 60 : 40;
  }
  if (design) {
    runs[0].title = 'Summarize this article';
    runs[0].mode = 'developer'; runs[0].workspaceId = 'fixture-workspace';
    runs[0].configSnapshot = { conversationSettings: { model: 'fixture-balanced', config: { modelReasoningEffort: 'high', sandboxMode: 'workspace-write', thinkingMode: true } }, apiKey: 'fixture-must-not-cache' };
    const at = delta => new Date(date.getTime() + delta);
    artifacts.set('fixture-run', [
      { id: 1, runId: 'fixture-run', kind: 'user-prompt', content: 'https://engineering.fb.com/2020/05/08/web/facebook-redesign/ şunu bana özetlesene', metadata: { source: 'user' }, createdAt: at(0) },
      { id: 2, runId: 'fixture-run', kind: 'report', content: 'Kaynağı inceleyip temel yaklaşımı çıkarıyorum.', metadata: {}, createdAt: at(1000) },
      { id: 3, runId: 'fixture-run', kind: 'report', content: 'Yazı, Facebook’un **web sitesini React ve Relay üzerine yeniden kurarken hız ve bakım sorunlarını nasıl çözdüğünü** anlatıyor. Yıllar içinde biriken teknoloji, siteyi yavaşlatmış ve karanlık mod gibi özellikleri eklemeyi zorlaştırmış. [Kaynak](https://engineering.fb.com/2020/05/08/web/facebook-redesign/)\n\nTemel yaklaşımları: **Yalnızca gereken kaynakları yükle; ihtiyaç duyulacağını bildiğin kaynakları da mümkün olduğunca erken getirmeye başla.**\n\nBunu dört alanda uygulamışlar:\n\n- **CSS’i küçültmüşler:** Tekrarlanan stil kurallarını paylaşan atomic CSS üretmişler.\n- **JavaScript’i önceliklendirmişler:** Önce sayfanın iskeleti, ardından görünen içeriği tamamlayan kod yükleniyor.\n- **Veriyi daha erken istemişler:** Kod ve veri paralel getiriliyor.\n- **Geçişleri hızlandırmışlar:** Kullanıcının sonraki adımı için gerekli kaynaklar hazırlanıyor.\n\n```swift\nlet nextStep = "Build, use, refine"\n```', metadata: {}, createdAt: at(3000) },
    ]);
    tools.set('fixture-run', [{ id: 1, toolName: 'WebFetch', status: 'done', createdAt: at(2000) }]);
  }
  if (media) {
    const at = delta => new Date(date.getTime() + delta);
    artifacts.set('fixture-run', [
      { id: 1, runId: 'fixture-run', kind: 'user-prompt', content: 'Review these files', metadata: { attachments: [
        { attachmentId: 'b'.repeat(64), name: 'photo.png', type: 'image', mimeType: 'image/png', byteSize: 68 },
        { attachmentId: 'c'.repeat(64), name: 'report.pdf', type: 'document', mimeType: 'application/pdf', byteSize: pdfBytes.length },
      ] }, createdAt: at(0) },
      { id: 2, runId: 'fixture-run', kind: 'report', content: 'Preparing the files.', metadata: {}, createdAt: at(1000) },
      { id: 504, runId: 'fixture-run', kind: 'image', content: null, path: '/fixture/result.png', metadata: { fileName: 'result.png' }, createdAt: at(2000) },
      { id: 505, runId: 'fixture-run', kind: 'document', content: null, path: '/fixture/report.pdf', metadata: { fileName: 'report.pdf', outputSelected: true, byteSize: pdfBytes.length }, createdAt: at(2500) },
      { id: 506, runId: 'fixture-run', kind: 'report', content: 'The image and PDF are ready.', metadata: {}, createdAt: at(4000) },
    ]);
    tools.set('fixture-run', [
      { id: 7, toolName: 'Bash', status: 'error', input: { command: 'npm test' }, output: { type: 'mains/deferred-tool-output', preview: 'Failure preview', chars: 40000 }, error: 'Command failed with exit code 1', createdAt: at(1200), startedAt: at(1200), endedAt: at(1500) },
      { id: 8, toolName: 'Edit', status: 'done', input: { file_path: '/fixture/page.tsx', old_string: 'old', new_string: 'new\nextra' }, output: null, createdAt: at(1600), endedAt: at(1900) },
    ]);
  }
  if (workspaceList) {
    const titles = ['Friendly Greeting', 'Friendly Greeting', 'Improve Homepage Description'];
    const ages = [52 * 60000, 11 * 3600000, 3 * 86400000];
    for (const [index, suffix] of ['first', 'second', 'third'].entries()) {
      const id = `workspace-${suffix}`, at = new Date(Date.now() - ages[index]);
      runs.push({ ...runs[0], id, title: titles[index], spaceId: 'fixture-code', workspaceId: 'fixture-workspace', mode: 'developer', createdAt: at, updatedAt: at });
      artifacts.set(id, [
        { id: 1, runId: id, kind: 'user-prompt', content: 'Hello', metadata: { source: 'user' }, createdAt: at },
        { id: 2, runId: id, kind: 'report', content: 'Hello from this workspace.', metadata: {}, createdAt: new Date(at.getTime() + 1) },
      ]);
    }
  }
}
reset();
const workspaces = [{ id: 'fixture-workspace', name: 'mains', projectId: 'fixture-project', rootPath: '/fixture/mains', status: 'in_progress', updatedAt: new Date(), isArchived: false, isReplica: false },
  { id: 'fixture-docs', name: 'docs', projectId: 'fixture-project', rootPath: '/fixture/docs', status: 'todo', updatedAt: new Date(), isArchived: false, isReplica: false }];
const collections = [{ id: 'fixture-kitchen', name: 'Kitchen Notes', icon: 'icon:heart|amber', isArchived: false },
  { id: 'fixture-life', name: 'Life', icon: 'icon:heart|red', isArchived: false },
  { id: 'fixture-trips', name: 'Trips & Things', icon: 'icon:globe|green', isArchived: false }];
const modelList = [{ id: 'fixture-balanced', displayName: 'Balanced', description: 'For everyday tasks', isDefault: true, supportedEffortLevels: ['low', 'medium', 'high'], supportsFastMode: true },
  { id: 'fixture-thinking', displayName: 'Thinking toggle', supportedEffortLevels: [] },
  { id: 'fixture-single', displayName: 'Single effort', supportedEffortLevels: ['high'] },
  { id: 'fixture-deep', displayName: 'Deep Thinker', description: 'For complex problems', supportedEffortLevels: ['medium', 'high', 'xhigh'] }];
const outputBytes = Buffer.from('# Article summary\n\n' + 'A useful note from the conversation.\n'.repeat(4200));
const outputVersion = 'a'.repeat(64);
const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZl0AAAAASUVORK5CYII=';
// A valid, synthetic PDF with padding comments, large enough to cross a chunk.
function fixturePDF() {
  let source = '%PDF-1.4\n';
  const offsets = [0];
  const stream = 'BT /F1 18 Tf 30 100 Td (Mains native PDF fixture) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source + '% harmless fixture padding\n'.repeat(6000));
}
const pdfBytes = fixturePDF();
function send(socket, message) { if (socket.readyState === WebSocket.OPEN) socket.send(encodeWsMessage(message)); }
function broadcast(channel, payload) { for (const socket of connections) send(socket, { kind: 'event', channel, payload }); }
function event(channel, runId, extra = {}) { broadcast(channel, { runId, ts: Date.now(), ...extra }); }
function later(delay, callback) {
  const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
  timers.add(timer);
}
function startReply(runId, message, commandId) {
  const date = new Date();
  const streamId = `reply-${commandId}`;
  const reply = { streamId, content: '', stopped: false };
  replies.set(runId, reply);
  artifacts.get(runId).push({ id: nextID++, runId, kind: 'user-prompt', content: message, metadata: { source: 'user' }, createdAt: date });
  const run = runs.find(run => run.id === runId);
  run.status = 'running'; run.updatedAt = date;
  event(CHANNELS.runs.statusChanged, runId, { status: 'running' });
  event(CHANNELS.runs.eventPersisted, runId);
  for (const [delay, content] of [[350, 'Streaming a native reply…'], [1200, 'Streaming a native reply… almost there.']]) {
    later(delay, () => {
      if (replies.get(runId) !== reply || reply.stopped) return;
      reply.content = content;
      event(CHANNELS.runs.ephemeralEvent, runId, { event: { type: 'artifact', kind: 'report', content, streamId,
        metadata: { source: 'agent_message_streaming', streaming: true } } });
    });
  }
  later(message === 'Take your time' ? 30000 : 2400, () => {
    if (replies.get(runId) !== reply || reply.stopped) return;
    artifacts.get(runId).push({ id: nextID++, runId, kind: 'report', content: 'Native reply delivered.', metadata: { streamId }, createdAt: new Date() });
    run.status = 'succeeded'; run.updatedAt = new Date();
    event(CHANNELS.runs.statusChanged, runId, { status: 'succeeded' });
    event(CHANNELS.runs.eventPersisted, runId);
    // A late native callback must never revive an acknowledged stream.
    later(200, () => event(CHANNELS.runs.ephemeralEvent, runId, { event: { type: 'artifact', kind: 'report', content: 'STALE DELTA', streamId,
      metadata: { source: 'agent_message_streaming', streaming: true } } }));
  });
}
const server = http.createServer(async (request, response) => {
  const parts = []; for await (const part of request) parts.push(part);
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/observations') { response.end(JSON.stringify(observations)); return; }
  if (request.method === 'POST' && request.url === '/test/append-history') {
    const at = new Date();
    artifacts.get('fixture-run').push(
      { id: nextID++, runId: 'fixture-run', kind: 'user-prompt', content: 'A new message while reading', metadata: { source: 'user' }, createdAt: at },
      { id: nextID++, runId: 'fixture-run', kind: 'report', content: 'The latest response arrived.', metadata: {}, createdAt: new Date(at.getTime() + 1) });
    event(CHANNELS.runs.eventPersisted, 'fixture-run');
    response.end('{}'); return;
  }
  if (request.method === 'POST' && request.url === '/test/turn-changes') {
    const run = runs.find(value => value.id === 'fixture-run');
    run.mode = 'developer';
    storedTurns.set(run.id, [{ id: 91, runId: run.id, turnIndex: 0, status: 'completed', model: null,
      startedAt: run.createdAt, createdAt: run.createdAt, endedAt: artifacts.get(run.id).at(-1).createdAt,
      changes: { id: 'fixture-change-91', files: [{ path: 'src/café.swift', oldPath: undefined, status: 'modified', additions: 2, deletions: 1, binary: false }],
        fileCount: 5, additions: 2, deletions: 1, truncated: true, undoneAt: new Date() } }]);
    storedDiffs.set(`${run.id}:91`, 'diff --git a/src/café.swift b/src/café.swift\n@@ -1 +1,2 @@\n-old\n+café 👋\n+new é\n');
    event(CHANNELS.runs.diffUpdated, run.id);
    response.end('{}'); return;
  }
  if (request.method === 'POST' && request.url === '/test/decisions') {
    const body = JSON.parse(Buffer.concat(parts).toString() || '{}');
    if (body.questions) {
      artifacts.get('fixture-run').push({ id: nextID++, runId: 'fixture-run', kind: 'report', content: 'Choose the next step.', createdAt: new Date(),
        metadata: { source: 'codex_async_questions', questions: [{ title: 'What next?', options: ['Review', 'Plan'] }] } });
      event(CHANNELS.runs.eventPersisted, 'fixture-run');
    } else {
      const value = { requestId: 'fixture-decision', approvalToken: 'fixture-incarnation', runId: 'fixture-run', kind: 'ask_user',
        toolName: 'AskUserQuestion', header: 'Fixture question', question: 'Choose an approach', options: [{ label: 'Review', description: undefined }],
        isOther: true, isSecret: true, toolInput: { message: 'pending-input-must-not-cache' }, timestamp: Date.now(), expiresAt: Date.now() + 300000 };
      pendingDecisions.set(value.requestId, value); event(CHANNELS.runs.toolApprovalRequest, 'fixture-run', value);
    }
    response.end('{}'); return;
  }
  if (request.method === 'POST' && request.url === '/test/context') {
    const body = JSON.parse(Buffer.concat(parts).toString() || '{}');
    contextDelayMs = Math.min(15000, Math.max(0, Number(body.delayMs ?? 0)));
    contextInvalidRows = body.invalidRows === true;
    response.end('{}'); return;
  }
  if (request.method === 'POST' && request.url === '/test/hold-snapshot') {
    const body = JSON.parse(Buffer.concat(parts).toString() || '{}');
    holdSnapshot = Math.min(15000, Math.max(0, Number(body.durationMs ?? 700)));
    response.end('{}'); return;
  }
  if (request.method === 'POST' && request.url === '/test/offline') {
    acceptsConnections = false;
    for (const socket of connections) socket.terminate();
    later(3000, () => { acceptsConnections = true; });
    response.end('{}'); return;
  }
  if (request.method === 'POST' && request.url === '/pair') {
    const body = JSON.parse(Buffer.concat(parts).toString());
    if (!['ios-test', 'ios-test-chat', 'ios-test-home', 'ios-test-design', 'ios-test-workspace', 'ios-test-media', 'ios-test-paging', 'ios-test-paging-disjoint'].includes(body.code) || body.platform !== 'ios' || !body.deviceName) {
      response.writeHead(403); response.end(JSON.stringify({ error: 'Invalid pairing code' })); return;
    }
    const paging = body.code.startsWith('ios-test-paging');
    reset(body.code === 'ios-test-chat' || paging, body.code === 'ios-test-home', body.code === 'ios-test-design', body.code === 'ios-test-workspace', body.code === 'ios-test-media', paging, body.code === 'ios-test-paging-disjoint');
    response.end(JSON.stringify({ deviceId: 'fixture-phone', deviceToken: 'fixture-device-token', backend: descriptor })); return;
  }
  response.writeHead(404); response.end('{}');
});
const wss = new WebSocketServer({ noServer: true, handleProtocols: offered => offered.has('mains.v1') ? 'mains.v1' : false });
server.on('upgrade', (request, socket, head) => {
  if (!acceptsConnections) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
  const offered = request.headers['sec-websocket-protocol'] ?? '';
  if (!offered.split(',').map(s => s.trim()).includes('mains.token.fixture-device-token')) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
  }
  wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
});
wss.on('connection', socket => {
  connections.add(socket);
  socket.on('close', () => connections.delete(socket));
  socket.on('message', data => {
    const message = decodeWsMessage(data.toString());
    const { id, channel, args, commandId } = message;
    observations.push({ channel, args, commandId });
    let result;
    try {
      if (receipts.has(commandId)) { send(socket, { kind: 'response', id, result: receipts.get(commandId) }); return; }
      switch (channel) {
        case CHANNELS.backend.describe: result = descriptor; break;
        case CHANNELS.account.get: result = { id: 'fixture-account', displayName: 'Fixture' }; break;
        case CHANNELS.runs.getAll:
          if (holdSnapshot) {
            const delay = holdSnapshot; holdSnapshot = 0;
            const captured = encodeWsMessage({ kind: 'response', id, result: { success: true, data: runs } });
            later(delay, () => { if (socket.readyState === WebSocket.OPEN) socket.send(captured); }); return;
          }
          result = runs; break;
        case CHANNELS.space.getAll: result = { spaces }; break;
        case CHANNELS.space.update: {
          if (!commandId) throw new Error('Missing command identity');
          const space = spaces.find(s => s.id === args[0]);
          const modes = ['codex', 'claude_code'].includes(space?.providerId) ? ['developer', 'work', 'chat'] : ['developer'];
          if (!space || !modes.includes(args[1].mode)) throw new Error('Unsupported mode');
          space.mode = args[1].mode; result = { ...space };
          receipts.set(commandId, { success: true, data: result });
          broadcast(CHANNELS.space.changed, { spaceId: space.id }); break;
        }
        case CHANNELS.workspace.list: result = workspaces; break;
        case CHANNELS.workspace.listGitStates: result = workspaces.map(w => ({ workspaceId: w.id, branch: w.id === 'fixture-docs' ? 'master' : 'main', pathExists: true })); break;
        case CHANNELS.collections.list: {
          if (args[0]?.accountId !== 'fixture-account') throw new Error('Collections require account ownership');
          result = collections; break;
        }
        case CHANNELS.projects.list: result = [{ id: 'fixture-project', name: 'Mains', icon: 'icon:folder' }]; break;
        case CHANNELS.providers.getEnabled: result = ['codex', 'claude_code', 'copilot_cli', 'cursor'].map(id => ({ id, config: { modelReasoningEffort: 'medium', effortLevel: 'medium', permissionMode: id === 'claude_code' ? 'auto' : 'default', sandboxMode: 'workspace-write' } })); break;
        case CHANNELS.providers.getSkills:
          result = { skills: [
            { name: 'fixture-review', displayName: 'Fixture review', scope: args[1] ? 'project' : 'user', path: args[1] ? args[1] + '/.agents/skills/review/SKILL.md' : undefined, description: undefined, userInvokable: true },
            { name: 'hidden-context', userInvokable: false },
            ...(contextInvalidRows ? [{ name: '' }, { description: 'Missing a name' }, null] : []),
          ] };
          if (contextDelayMs) {
            const delayed = result;
            later(contextDelayMs, () => { if (socket.readyState === WebSocket.OPEN) send(socket, { kind: 'response', id, result: { success: true, data: delayed } }); });
            return;
          }
          break;
        case CHANNELS.providers.getCommands:
          result = [{ name: 'review', description: undefined, argumentHint: '[focus]', userFacing: true }, { name: 'internal', userFacing: false }]; break;
        case CHANNELS.providers.getModels:
          // Claude's SDK projection retains optional keys whose values are undefined.
          // The real wire codec tags those values rather than dropping the keys.
          result = args[0] === 'claude_code' ? modelList.map(model => ({
            ...model, description: model.description, isDefault: model.isDefault,
            supportsFastMode: model.supportsFastMode, supportedEffortLevels: model.supportedEffortLevels,
            serviceTiers: model.serviceTiers,
          })) : modelList;
          break;
        case CHANNELS.runs.updateConversationSettings: {
          if (!commandId) throw new Error('Missing command identity');
          const run = runs.find(r => r.id === args[0]);
          if (!run || !args[1]?.config) throw new Error('Invalid conversation settings');
          if (args[1].model === 'fixture-save-refused') throw new Error('Settings refused');
          run.configSnapshot = { ...run.configSnapshot, conversationSettings: args[1] }; result = args[1];
          receipts.set(commandId, { success: true, data: result });
          if (args[1].model === 'fixture-save-unknown') {
            send(socket, { kind: 'response', id, result: { success: false, error: 'Command outcome is unknown. Check the original save.' } }); return;
          }
          break;
        }
        case CHANNELS.runs.listOutputs: {
          if (!runs.some(r => r.id === args[0].runId)) throw new Error('Conversation not found');
          const pdf = args[0].artifactId === 505 || artifacts.get(args[0].runId)?.some(item => item.id === 505);
          const item = pdf ? { artifactId: 505, runId: args[0].runId, name: 'report.pdf', mimeType: 'application/pdf', byteSize: pdfBytes.length, version: outputVersion, previewType: 'native' }
            : { artifactId: 503, runId: args[0].runId, name: 'Article summary.md', mimeType: 'text/markdown', byteSize: outputBytes.length, version: outputVersion, previewType: 'markdown' };
          result = { items: args[0].offset > 0 ? [] : [item], nextOffset: null }; break;
        }
        case CHANNELS.runs.readOutputFile: {
          const input = args[0];
          const bytes = input.artifactId === 505 ? pdfBytes : outputBytes;
          if (!runs.some(r => r.id === input.runId) || ![503, 505].includes(input.artifactId) || input.version !== outputVersion || input.offset < 0 || input.offset >= bytes.length) throw new Error('Invalid output selection');
          const end = Math.min(bytes.length, input.offset + 128 * 1024);
          result = { base64: bytes.subarray(input.offset, end).toString('base64'), offset: input.offset, nextOffset: end < bytes.length ? end : null, byteSize: bytes.length, version: outputVersion }; break;
        }
        case CHANNELS.runArtifacts.readImage:
        case CHANNELS.runArtifacts.readAttachmentImage: {
          const input = args[0];
          if (input.runId !== 'fixture-run' || (input.artifactId !== 504 && input.attachmentId !== 'b'.repeat(64))) throw new Error('Invalid image reference');
          result = { mime: 'image/png', base64: imageBase64, width: 1, height: 1 }; break;
        }
        case CHANNELS.runArtifacts.describeAttachmentFile: {
          const input = args[0];
          if (input.runId !== 'fixture-run' || input.attachmentId !== 'c'.repeat(64)) throw new Error('Invalid attachment reference');
          result = { runId: input.runId, attachmentId: input.attachmentId, name: 'report.pdf', mimeType: 'application/pdf', byteSize: pdfBytes.length, modifiedAt: 0, version: outputVersion, previewType: 'native' }; break;
        }
        case CHANNELS.runArtifacts.readAttachmentChunk: {
          const input = args[0];
          if (input.runId !== 'fixture-run' || input.attachmentId !== 'c'.repeat(64) || input.version !== outputVersion || input.offset < 0 || input.offset >= pdfBytes.length) throw new Error('Invalid attachment selection');
          const end = Math.min(pdfBytes.length, input.offset + 128 * 1024);
          result = { base64: pdfBytes.subarray(input.offset, end).toString('base64'), offset: input.offset, nextOffset: end < pdfBytes.length ? end : null, byteSize: pdfBytes.length, version: outputVersion }; break;
        }
        case CHANNELS.runs.readHistoryContent: {
          if (args[0].source === 'turn-diff') {
            const { runId, id, offset = 0 } = args[0], patch = storedDiffs.get(`${runId}:${id}`);
            if (typeof patch !== 'string' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid turn diff reference');
            const chars = Array.from(patch), end = Math.min(chars.length, offset + 41);
            if (offset > chars.length) throw new Error('Invalid turn diff offset');
            result = { text: chars.slice(offset, end).join(''), offset, nextOffset: end < chars.length ? end : null, totalChars: chars.length }; break;
          }
          if (args[0].runId !== 'fixture-run' || args[0].source !== 'tool-output' || args[0].id !== 7) throw new Error('Invalid history content reference');
          result = { text: 'Full tool output', offset: 0, nextOffset: null, totalChars: 16 }; break;
        }
        case CHANNELS.providers.getCodexPermissions: result = { profilesSupported: true, profiles: [{ id: 'review', description: 'Managed review profile', allowed: true }], allowedSandboxModes: ['read-only', 'workspace-write'], allowedApprovalPolicies: null, requiresNamedProfile: false }; break;
        case CHANNELS.runs.getById: result = runs.find(run => run.id === args[0]) ?? null; break;
        case CHANNELS.runs.listPendingApprovals: result = [...pendingDecisions.values()].filter(value => !args[0] || value.runId === args[0]); break;
        case CHANNELS.runs.toolApprovalResponse: {
          const input = args[0], pending = pendingDecisions.get(input.requestId);
          if (!commandId || !pending || pending.approvalToken !== input.approvalToken) throw new Error('Stale decision identity');
          if (typeof input.approved !== 'boolean' || input.approved && !input.answer) throw new Error('Missing decision answer');
          pendingDecisions.delete(input.requestId); result = null;
          receipts.set(commandId, { success: true, data: result });
          broadcast(CHANNELS.runs.toolApprovalResolved, { requestId: input.requestId, approvalToken: input.approvalToken }); break;
        }
        case CHANNELS.runs.answerAsyncQuestions:
        case CHANNELS.runs.dismissAsyncQuestions: {
          const input = args[0];
          const artifact = artifacts.get(input.runId)?.find(item => item.id === input.artifactId && item.metadata?.source === 'codex_async_questions');
          if (!commandId || input.accountId !== 'fixture-account' || !artifact) throw new Error('Invalid question ownership');
          if (channel === CHANNELS.runs.dismissAsyncQuestions) { artifact.metadata.asyncQuestionState = { dismissed: true }; result = null; }
          else if (artifact.metadata.asyncQuestionAnswer) { result = { accepted: true, answer: artifact.metadata.asyncQuestionAnswer }; }
          else if (input.checkOnly) { result = { accepted: false }; }
          else {
            if (input.answers?.length !== 1 || !input.answers[0]?.trim()) throw new Error('Missing answer');
            const answer = { artifactId: artifact.id, answers: input.answers, clientUserMessageId: `codex-async-answer-${artifact.id}` };
            artifact.metadata.asyncQuestionAnswer = answer;
            artifacts.get(input.runId).push({ id: nextID++, runId: input.runId, kind: 'user-prompt', content: input.answers[0], createdAt: new Date(),
              metadata: { clientUserMessageId: answer.clientUserMessageId, asyncQuestionReply: { artifactId: artifact.id, answers: input.answers } } });
            result = { accepted: true, answer };
          }
          receipts.set(commandId, { success: true, data: result }); event(CHANNELS.runs.eventPersisted, input.runId); break;
        }
        case CHANNELS.runs.getHistory: {
          if (args[0].profile !== 'mobile') throw new Error('Missing bounded mobile profile');
          const all = artifacts.get(args[0].runId) ?? [];
          if (disjointHistory) {
            // Mobile pages may split a long prompt at their row/byte cap and have no overlap.
            const key = row => ({ timestamp: row.createdAt.getTime(), source: 'artifact', id: row.id });
            const compare = (a, b) => a.timestamp - b.timestamp || a.id - b.id;
            const input = args[0], newer = input.direction === 'newer';
            const lower = newer || input.direction === 'refresh' ? input.cursor : null;
            const upper = input.direction === 'older' ? input.cursor : input.direction === 'refresh' ? input.end : null;
            const eligible = all.filter(row => (!lower || compare(key(row), lower) >= 0) && (!upper || compare(key(row), upper) < 0));
            const selected = newer ? eligible.slice(0, 6) : eligible.slice(-6);
            const end = newer && selected.at(-1)?.id !== all.at(-1)?.id ? { ...key(selected.at(-1)), id: selected.at(-1).id + 1 } : upper ?? null;
            const start = selected.length ? key(selected[0]) : null;
            result = { artifacts: selected, toolCalls: [], turns: [], start, end, last: all.length ? key(all.at(-1)) : null,
              hasOlder: !!start && start.id !== all[0]?.id, hasNewer: !!end && all.some(row => compare(key(row), end) >= 0) };
            break;
          }
          if (pagedHistory) {
            const key = row => ({ timestamp: row.createdAt.getTime(), source: 'artifact', id: row.id });
            const compare = (a, b) => a.timestamp - b.timestamp || a.id - b.id;
            const anchors = all.filter(row => row.kind === 'user-prompt').map(key);
            const input = args[0], seek = cursor => {
              const index = anchors.findIndex(anchor => compare(anchor, cursor) >= 0);
              return index < 0 ? anchors.length : index;
            };
            let start = Math.max(0, anchors.length - 3), end = anchors.length, upper = null;
            if (input.direction === 'older') { start = Math.max(0, seek(input.cursor) - 3); end = Math.min(anchors.length, start + 9); upper = anchors[end] ?? null; }
            if (input.direction === 'newer') { end = Math.min(anchors.length, seek(input.cursor) + 3); start = Math.max(0, end - 9); upper = anchors[end] ?? null; }
            if (input.direction === 'refresh') { start = input.cursor ? seek(input.cursor) : start; upper = input.end ?? null; }
            const lower = anchors[start] ?? null;
            const selected = all.filter(row => (!lower || compare(key(row), lower) >= 0) && (!upper || compare(key(row), upper) < 0));
            result = { artifacts: selected, toolCalls: [], turns: [], start: lower, end: upper, last: all.length ? key(all.at(-1)) : null,
              hasOlder: start > 0, hasNewer: !!upper && all.some(row => compare(key(row), upper) >= 0) };
            break;
          }
          const lower = args[0].direction === 'refresh' ? args[0].cursor : null;
          const upper = args[0].direction === 'refresh' ? args[0].end : null;
          const compare = (item, cursor) => item.createdAt.getTime() - cursor.timestamp || item.id - cursor.id;
          const items = all.filter(item => (!lower || compare(item, lower) >= 0) && (!upper || compare(item, upper) < 0)).slice(-200);
          result = { artifacts: items, toolCalls: tools.get(args[0].runId) ?? [], turns: storedTurns.get(args[0].runId) ?? [], start: items.length ? { timestamp: items[0].createdAt.getTime(), source: 'artifact', id: items[0].id } : null,
            end: upper ?? null, last: items.length ? { timestamp: items.at(-1).createdAt.getTime(), source: 'artifact', id: items.at(-1).id } : null,
            hasOlder: items.length > 0 && items[0].id !== all[0]?.id, hasNewer: !!upper && all.some(item => compare(item, upper) >= 0) };
          break;
        }
        case CHANNELS.runs.execute:
        case CHANNELS.runs.continue: {
          const input = args[0];
          if (!commandId || input.accountId !== 'fixture-account') throw new Error('Missing command identity or account');
          if (input.message === 'Refuse this message') throw new Error('This message was refused by the test computer.');
          if (input.message === 'Unknown outcome') {
            const failure = { success: false, error: 'Command outcome is unknown because its result was not recorded. Check the conversation before sending another command.' };
            receipts.set(commandId, failure);
            send(socket, { kind: 'response', id, result: failure }); return;
          }
          if (channel === CHANNELS.runs.execute && !spaces.some(space => space.id === input.spaceId)) throw new Error('Invalid space');
          const runId = input.runId ?? `new-${nextID++}`;
          if (!artifacts.has(runId)) {
            artifacts.set(runId, []);
            const space = spaces.find(s => s.id === input.spaceId);
            runs.unshift({ ...runs[0], id: runId, title: input.goal, spaceId: input.spaceId, providerId: space.providerId, mode: space.mode,
              workspaceId: input.workspaceId ?? null, collectionId: input.collectionId ?? null, model: input.model ?? null,
              configSnapshot: { conversationSettings: input.conversationSettings },
              createdAt: new Date(), updatedAt: new Date() });
          }
          result = { runId, resumed: true };
          receipts.set(commandId, { success: true, data: result });
          startReply(runId, input.message ?? input.goal, commandId);
          if (input.message === 'Reconnect once') { socket.terminate(); return; }
          break;
        }
        case CHANNELS.runs.abort: {
          if (!commandId) throw new Error('Missing command identity');
          const reply = replies.get(args[0]);
          if (reply && !reply.stopped) {
            reply.stopped = true;
            artifacts.get(args[0]).push({ id: nextID++, runId: args[0], kind: 'report', content: reply.content || 'Reply stopped.',
              metadata: { streamId: reply.streamId }, createdAt: new Date() });
          }
          runs.find(run => run.id === args[0]).status = 'canceled';
          event(CHANNELS.runs.statusChanged, args[0], { status: 'canceled' });
          event(CHANNELS.runs.eventPersisted, args[0]);
          const receipt = { success: true, data: null };
          receipts.set(commandId, receipt);
          later(800, () => send(socket, { kind: 'response', id, result: receipt })); return;
        }
        case 'test:never': return;
        case 'test:refuse': throw new Error('Explicit refusal');
        default: throw new Error(`Unsupported fixture channel: ${channel}`);
      }
      send(socket, { kind: 'response', id, result: { success: true, data: result } });
    } catch (error) { send(socket, { kind: 'response', id, result: { success: false, error: error.message } }); }
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Mains iOS protocol fixture listening on 127.0.0.1:${port}`));
