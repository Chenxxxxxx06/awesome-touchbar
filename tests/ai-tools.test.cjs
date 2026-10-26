'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createAiTools } = require('../desktop/ai-tools.cjs');
// This isolated test worker reads only explicit temporary fixture homes or mock data.
// CI's global desktop mock flag must not bypass parser fixtures.
delete process.env.TOUCH_BAR_CONTROLS_MODE;
delete process.env.TOUCH_BAR_AI_MODE;
const NOW = Date.parse('2026-10-26T10:00:00Z');
const stamp = offset => new Date(NOW + offset).toISOString();
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'touchbar-ai-test-'));
  t.after(() => {
    const resolved = path.resolve(home);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('touchbar-ai-test-')) fs.rmSync(resolved, { recursive: true, force: true });
  });
  function write(relative, records) {
    const file = path.join(home, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
    fs.utimesSync(file, new Date(NOW), new Date(NOW)); return file;
  }
  return { home, write };
}
const meta = (id, source = 'cli') => ({ type: 'session_meta', timestamp: stamp(-3600000), payload: { id, source, timestamp: stamp(-3600000), model_provider: 'openai' } });
const usage = (thread, response, total, offset = -1000) => ({ type: 'token_usage_record', timestamp: stamp(offset), payload: { thread_id: thread, response_id: response, usage: { total_tokens: total } } });
const old = (total, ordinal, offset = -1000) => ({ type: 'event_msg', timestamp: stamp(offset), ordinal, payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total } } } });

test('AI mock exposes fixtures without reading a home path and returned state is isolated', async () => {
  const service = createAiTools({ mode: 'mock', home: '\0invalid-path', now: () => NOW });
  const first = await service.getState();
  assert.deepEqual(first.tools.map(x => x.id), ['codex', 'claude', 'pi']);
  assert.equal(first.tools[0].quota.remainingPercent, 62);
  first.tools.length = 0;
  assert.equal((await service.getState()).tools.length, 3);
  service.dispose(); await assert.rejects(service.getState(), /关闭/);
});

test('Codex modern usage deduplicates responses, excludes inherited parent records and does not add legacy snapshots', async t => {
  const { home, write } = fixture(t);
  write('.codex/sessions/root.jsonl', [meta('root'), usage('root', 'r1', 100), old(100, 1), usage('root', 'r1', 100), usage('root', 'r2', 25)]);
  write('.codex/sessions/child.jsonl', [meta('child', { subagent: {} }), usage('root', 'r1', 100), old(100, 1), usage('child', 'r3', 30), old(130, 2)]);
  const service = createAiTools({ home, now: () => NOW }); t.after(() => service.dispose());
  const state = await service.getState();
  assert.equal(state.tools[0].totalTokens, 155); assert.equal(state.tools[0].todayTokens, 155);
  assert.equal(state.partial, false); assert.match(state.tools[0].source, /本地可读/);
});

test('legacy Codex cumulative snapshots add differences and forks establish a baseline', async t => {
  const { home, write } = fixture(t);
  write('.codex/sessions/root.jsonl', [meta('root'), old(100, 1), old(100, 2), old(160, 3)]);
  write('.codex/sessions/fork.jsonl', [meta('fork', { subagent: {} }), old(160, 1), old(190, 2)]);
  const service = createAiTools({ home, now: () => NOW }); t.after(() => service.dispose());
  assert.equal((await service.getState()).tools[0].totalTokens, 190);
});

test('Claude streamed duplicates and Pi projected responses count once with provider preserved', async t => {
  const { home, write } = fixture(t);
  const assistant = tokens => ({ type: 'assistant', timestamp: stamp(-1000), message: { id: 'm1', usage: { input_tokens: 10, output_tokens: tokens, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 } } });
  write('.claude/projects/p/a.jsonl', [assistant(2), assistant(7)]);
  write('.claude/projects/p/subagents/b.jsonl', [assistant(7)]);
  const pi = { type: 'message', id: 'entry', timestamp: stamp(-1000), message: { role: 'assistant', provider: 'DeepSeek', responseId: 'p1', usage: { input: 10, output: 3, cacheRead: 5, totalTokens: 18 } } };
  write('.pi/agent/sessions/p/a.jsonl', [pi]); write('.pi/agent/sessions/p/b.jsonl', [pi]);
  const service = createAiTools({ home, now: () => NOW }); t.after(() => service.dispose());
  const state = await service.getState();
  assert.equal(state.tools.find(x => x.id === 'claude').totalTokens, 42);
  const tool = state.tools.find(x => x.id === 'pi'); assert.equal(tool.totalTokens, 18); assert.equal(tool.provider, 'DeepSeek');
  assert.equal(tool.quota, null); assert.equal(tool.status, 'recent');
});

test('quota selects the most limited valid window and expires without fabricating remaining allowance', async t => {
  const { home, write } = fixture(t); let now = NOW;
  write('.codex/sessions/quota.jsonl', [meta('root'), { type: 'event_msg', timestamp: stamp(-1000), payload: { type: 'token_count', rate_limits: {
    primary: { used_percent: 10, resets_at: (NOW + 3600000) / 1000, window_minutes: 300 },
    secondary: { used_percent: 82, resets_at: (NOW + 86400000) / 1000, window_minutes: 10080 }
  } } }]);
  const service = createAiTools({ home, now: () => now, cacheMs: 0 }); t.after(() => service.dispose());
  assert.equal((await service.getState()).tools[0].quota.remainingPercent, 18);
  now += 16 * 60000;
  const tool = (await service.getState()).tools[0]; assert.equal(tool.quota, null); assert.match(tool.note, /过期/);
  assert.equal(tool.totalTokens, null);
});

test('current task status uses lifecycle evidence and task text masks secrets', async t => {
  const { home, write } = fixture(t);
  const file = write('.codex/sessions/live.jsonl', [meta('root'),
    { type: 'event_msg', timestamp: stamp(-2000), payload: { type: 'task_started' } },
    { type: 'event_msg', timestamp: stamp(-1000), payload: { type: 'user_message', message: 'Fix parser api_key=sk-abcdef12345678 and tests' } }, usage('root', 'r1', 10)]);
  let now = NOW; const service = createAiTools({ home, now: () => now, cacheMs: 0 }); t.after(() => service.dispose());
  let tool = (await service.getState()).tools[0]; assert.equal(tool.status, 'running'); assert.ok(tool.task.length <= 80); assert.ok(!tool.task.includes('abcdef'));
  fs.appendFileSync(file, JSON.stringify({ type: 'event_msg', timestamp: stamp(1000), payload: { type: 'task_complete' } }) + '\n'); now += 1500;
  tool = (await service.getState()).tools[0]; assert.equal(tool.status, 'recent'); assert.equal(tool.totalTokens, 10);
  now += 6 * 60000; assert.equal((await service.getState()).tools[0].status, 'idle');
});

test('incremental reads retain incomplete lines and do not recount appended usage; partial is explicit', async t => {
  const { home, write } = fixture(t); let now = NOW;
  const file = write('.codex/sessions/small.jsonl', [meta('root'), usage('root', 'r1', 10)]);
  const service = createAiTools({ home, now: () => now, cacheMs: 0, readBudget: 100 }); t.after(() => service.dispose());
  assert.equal((await service.getState()).partial, true);
  for (let i = 0; i < 12; i++) { now += 10; await service.getState(); }
  assert.equal((await service.getState()).tools[0].totalTokens, 10);
  const added = JSON.stringify(usage('root', 'r2', 5)); fs.appendFileSync(file, added.slice(0, 20)); now += 10; await service.getState();
  fs.appendFileSync(file, added.slice(20) + '\n');
  for (let i = 0; i < 5; i++) { now += 10; await service.getState(); }
  assert.equal((await service.getState()).tools[0].totalTokens, 15);
});

test('daily buckets use Asia/Shanghai rather than UTC dates', async t => {
  const { home, write } = fixture(t); const now = Date.parse('2026-10-26T17:00:00Z');
  write('.codex/sessions/time.jsonl', [meta('root'), { type: 'token_usage_record', timestamp: '2026-10-26T16:30:00Z', payload: { thread_id: 'root', response_id: 'r1', usage: { total_tokens: 8 } } }]);
  const service = createAiTools({ home, now: () => now }); t.after(() => service.dispose());
  const tool = (await service.getState()).tools[0]; assert.equal(tool.activity[0].date, '2026-10-27'); assert.equal(tool.todayTokens, 8);
});

test('mixed Codex formats flag excluded historical legacy usage and incomplete empty today remains unknown', async t => {
  const {home,write}=fixture(t);
  write('.codex/sessions/mixed.jsonl',[{type:'session_meta',timestamp:stamp(-2*86400000),payload:{id:'root',timestamp:stamp(-2*86400000)}},old(100,1,-86400000),usage('root','r1',20,-60000)]);
  const service=createAiTools({home,now:()=>NOW});t.after(()=>service.dispose());
  const state=await service.getState();assert.equal(state.partial,true);assert.match(state.tools[0].note,/混合/);
  const pending=createAiTools({home,now:()=>NOW,readBudget:5});t.after(()=>pending.dispose());
  assert.equal((await pending.getState()).tools[0].todayTokens,null);
});
test('reading older Pi chunks cannot replace a provider found in the latest tail',async t=>{
  const {home,write}=fixture(t);
  write('.pi/agent/sessions/a.jsonl',[
    {type:'model_change',timestamp:stamp(-60000),provider:'Old'},
    {type:'message',id:'padding',timestamp:stamp(-50000),message:{role:'user',content:'x'.repeat(3000)}},
    {type:'model_change',timestamp:stamp(-1000),provider:'DeepSeek'}
  ]);
  const service=createAiTools({home,now:()=>NOW,readBudget:200});t.after(()=>service.dispose());
  assert.equal((await service.getState()).tools[0].provider,'DeepSeek');
});

test('unknown AI mode fails closed before touching a profile',async()=>{
  const service=createAiTools({mode:'mok',home:'\0invalid'});
  await assert.rejects(service.getState(),/未知 AI 数据模式/);service.dispose();
});
test('a linked session root is not followed',async t=>{
  const {home,write}=fixture(t);write('outside/session.jsonl',[meta('root'),usage('root','r1',10)]);
  fs.mkdirSync(path.join(home,'.codex'),{recursive:true});
  try { fs.symlinkSync(path.join(home,'outside'),path.join(home,'.codex/sessions'),process.platform==='win32'?'junction':'dir'); }
  catch(error) { if(['EPERM','EACCES'].includes(error.code)){t.skip('Host cannot create a temporary directory link');return;}throw error; }
  const service=createAiTools({home,now:()=>NOW});t.after(()=>service.dispose());
  const state=await service.getState();assert.equal(state.tools[0].totalTokens,null);assert.equal(state.tools[0].task,null);
});
