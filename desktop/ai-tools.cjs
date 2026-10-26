'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { StringDecoder } = require('node:string_decoder');
const DAY = 86400000;
const TOOLS = [
  { id: 'codex', name: 'Codex', dir: '.codex', logs: ['sessions', 'archived_sessions'] },
  { id: 'claude', name: 'Claude Code', dir: '.claude', logs: ['projects'] },
  { id: 'pi', name: 'Pi', dir: '.pi/agent', logs: ['sessions'] },
];
const clone = value => JSON.parse(JSON.stringify(value));
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const time = value => { const n = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value); return Number.isFinite(n) ? n : null; };
const day = value => new Date(value + 8 * 3600000).toISOString().slice(0, 10);
function label(value, max = 80) {
  if (typeof value !== 'string') return null;
  let text = value.split('## My request:').pop().replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, '[链接]')
    .replace(/(?:sk-|ghp_|github_pat_|Bearer\s+)[\w.-]{8,}/gi, '[已隐藏]')
    .replace(/(?:api[_ -]?key|authorization|password|token|secret)\s*[:=]\s*\S+/gi, '[已隐藏]')
    .replace(/\s+/g, ' ').trim();
  if (!text || (!value.includes('## My request:') && /^# Files mentioned|^You are |^<environment_context/.test(value))) return null;
  return text.slice(0, max);
}
function tokenTotal(usage, kind) {
  if (!usage || typeof usage !== 'object') return null;
  const explicit = number(usage.total_tokens ?? usage.totalTokens);
  if (explicit !== null) return explicit;
  const keys = kind === 'claude' ? ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    : kind === 'pi' ? ['input', 'output', 'cacheRead', 'cacheWrite'] : ['input_tokens', 'output_tokens'];
  const values = keys.map(key => number(usage[key]));
  return values.some(value => value !== null) ? values.reduce((sum, value) => sum + (value ?? 0), 0) : null;
}
function emptyFile(meta) {
  return { ...meta, offset: 0, carry: '', decoder: new StringDecoder('utf8'), records: new Map(), oldRecords: new Map(),
    hasModern: false, firstModernAt: Infinity, providerTime: 0, session: null, born: null, subagent: false, previousTotal: null,
    latest: 0, task: null, taskTime: 0, started: 0, completed: 0, provider: null, quota: null, partial: false };
}
function remember(file, id, tokens, timestamp, map = file.records) {
  if (tokens === null || timestamp === null || !id) return;
  const existing = map.get(id);
  if (!existing || tokens > existing.tokens) map.set(id, { tokens, timestamp });
}
function taskText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  return content.filter(item => item && ['text', 'input_text'].includes(item.type)).map(item => item.text || '').join(' ');
}
function ingest(file, record, counts = true) {
  const p = record.payload || {}, m = record.message || {};
  const at = time(record.timestamp ?? m.timestamp);
  if (at !== null) file.latest = Math.max(file.latest, at);
  if (file.tool === 'codex') {
    if (record.type === 'session_meta') {
      file.session = p.id || p.session_id || file.session;
      file.born = time(p.timestamp ?? record.timestamp);
      file.subagent = Boolean(p.source && typeof p.source === 'object' && p.source.subagent);
      setProvider(file, p.model_provider, at);
    }
    if (record.type === 'event_msg') {
      if (p.type === 'task_started' && at !== null) file.started = Math.max(file.started, at);
      if (['task_complete', 'task_completed', 'turn_aborted'].includes(p.type) && at !== null) file.completed = Math.max(file.completed, at);
      if (p.type === 'user_message' && at !== null) setTask(file, p.message, at);
      if (p.type === 'token_count') {
        if (p.rate_limits && at !== null && (!file.quota || at >= file.quota.at)) file.quota = { at, value: p.rate_limits };
        if (counts) {
          const total = tokenTotal(p.info?.total_token_usage, 'codex');
          if (total !== null) {
            const previous = file.previousTotal;
            file.previousTotal = total;
            // Forked old-format transcripts inherit a parent's cumulative counter.
            // The first child snapshot establishes its baseline, not fresh usage.
            const fresh = file.born === null || at === null || at >= file.born;
            const delta = previous === null ? (file.subagent ? 0 : total) : Math.max(0, total - previous);
            if (fresh) remember(file, 'old:' + String(record.ordinal ?? at) + ':' + total, delta, at, file.oldRecords);
          }
        }
      }
    }
    if (record.type === 'response_item' && p.type === 'message' && p.role === 'user' && at !== null) setTask(file, taskText(p.content), at);
    if (counts && record.type === 'token_usage_record') {
      file.hasModern = true;
      if (at !== null) file.firstModernAt = Math.min(file.firstModernAt, at);
      // Modern records carry stable response IDs and the originating thread ID.
      // Inherited parent history must not be counted as this child session's use.
      if (file.session && p.thread_id && p.thread_id !== file.session) return;
      const id = p.response_id || (String(p.thread_id || file.session) + ':' + String(record.ordinal));
      remember(file, 'codex:' + id, tokenTotal(p.usage, 'codex'), at);
    }
  } else if (file.tool === 'claude') {
    if (record.type === 'user' && at !== null) setTask(file, taskText(m.content), at);
    if (counts && record.type === 'assistant' && m.id) remember(file, 'claude:' + m.id, tokenTotal(m.usage, 'claude'), at);
  } else {
    if (record.type === 'session') file.session = record.id || file.session;
    if (record.type === 'model_change') setProvider(file, record.provider, at);
    if (record.type === 'message') {
      if (m.provider) setProvider(file, m.provider, at);
      if (m.role === 'user' && at !== null) setTask(file, taskText(m.content), at);
      if (counts && m.role === 'assistant') remember(file, 'pi:' + (m.responseId || record.id), tokenTotal(m.usage, 'pi'), at);
    }
  }
}
function setProvider(file, value, at) {
  const provider = label(value, 30);
  if (provider && at !== null && at >= file.providerTime) { file.provider = provider; file.providerTime = at; }
}
function setTask(file, value, at) {
  const text = label(value);
  if (text && at >= file.taskTime) { file.task = text; file.taskTime = at; }
}
function quotaSnapshot(candidate, now) {
  if (!candidate || candidate.at > now + 60000 || now - candidate.at > 15 * 60000) return null;
  const windows = ['primary', 'secondary'].map(key => {
    const window = candidate.value[key];
    const used = number(window?.used_percent), reset = time(window?.resets_at);
    if (used === null || used > 100 || reset === null || reset <= now) return null;
    const minutes = number(window.window_minutes);
    const duration = minutes === null ? key : minutes % 60 === 0 ? (minutes / 60) + ' 小时' : minutes + ' 分钟';
    return { usedPercent: used, remainingPercent: 100 - used, resetAt: new Date(reset).toISOString(), updatedAt: new Date(candidate.at).toISOString(), source: 'Codex 本地额度快照 · ' + duration + '窗口' };
  }).filter(Boolean);
  return windows.sort((a, b) => a.remainingPercent - b.remainingPercent)[0] || null;
}
function mockState(now) {
  const activity = Array.from({ length: 91 }, (_, index) => ({ date: day(now - (90 - index) * DAY), tokens: index % 5 === 0 ? 0 : (index * 1739) % 82000 }));
  return { updatedAt: new Date(now).toISOString(), historyDays: 91, partial: false, tools: [
    { id: 'codex', name: 'Codex', provider: 'OpenAI', status: 'running', task: '实现 AI 工具状态组件', taskUpdatedAt: new Date(now).toISOString(), todayTokens: 42800, totalTokens: 1248000, activity, quota: { usedPercent: 38, remainingPercent: 62, resetAt: new Date(now + 2 * 3600000).toISOString(), updatedAt: new Date(now).toISOString(), source: '模拟 5 小时窗口' }, source: '模拟记录', note: null },
    { id: 'claude', name: 'Claude Code', provider: null, status: 'idle', task: '整理项目文档', taskUpdatedAt: new Date(now - DAY).toISOString(), todayTokens: 0, totalTokens: 189000, activity: activity.map(item => ({ ...item, tokens: Math.round(item.tokens / 3) })), quota: null, source: '模拟记录', note: '未提供可读取的额度数据' },
    { id: 'pi', name: 'Pi', provider: 'DeepSeek', status: 'recent', task: '检查配置', taskUpdatedAt: new Date(now - 60000).toISOString(), todayTokens: 12400, totalTokens: 76000, activity: activity.map(item => ({ ...item, tokens: Math.round(item.tokens / 8) })), quota: null, source: '模拟记录', note: '未提供可读取的额度数据' },
  ] };
}
function createAiTools(options = {}) {
  const mode = process.env.TOUCH_BAR_CONTROLS_MODE === 'mock' ? 'mock' : (options.mode ?? process.env.TOUCH_BAR_AI_MODE ?? 'live');
  const home = options.home || os.homedir();
  const nowFn = options.now || Date.now;
  const historyDays = 91;
  const files = new Map();
  const detected = new Set();
  const discoveryPartial = new Set();
  let lastDiscovery = -Infinity, lastRead = -Infinity, cached, pending, disposed = false, cursor = 0;
  const maxFiles = options.maxFiles ?? 180;
  const readBudget = options.readBudget ?? 12 * 1024 * 1024;
  const cacheMs = options.cacheMs ?? 5000;
  async function walk(directory, depth = 5) {
    if (depth < 0) return [];
    try { const root = await fs.lstat(directory); if (!root.isDirectory() || root.isSymbolicLink()) return []; } catch { return []; }
    let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return []; }
    const found = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) found.push(...await walk(full, depth - 1));
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try { const stat = await fs.stat(full); found.push({ path: full, size: stat.size, mtime: stat.mtimeMs }); } catch { /* Files can rotate while scanning. */ }
      }
      if (found.length >= 3000) break;
    }
    return found;
  }
  async function discover(now) {
    if (now - lastDiscovery < 30000) return;
    lastDiscovery = now;
    discoveryPartial.clear();
    detected.clear();
    const retained = new Set();
    for (const tool of TOOLS) {
      const directory = path.join(home, tool.dir);
      try { const stat = await fs.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) continue; } catch { continue; }
      detected.add(tool.id);
      const all = (await Promise.all(tool.logs.map(log => walk(path.join(directory, log))))).flat();
      const recent = all.filter(item => item.mtime >= now - historyDays * DAY).sort((a, b) => b.mtime - a.mtime);
      if (recent.length > maxFiles || all.length >= 3000) discoveryPartial.add(tool.id);
      for (const meta of recent.slice(0, maxFiles)) {
        retained.add(meta.path);
        const previous = files.get(meta.path);
        if (!previous || meta.size < previous.offset || (meta.size === previous.offset && meta.mtime !== previous.mtime)) files.set(meta.path, emptyFile({ ...meta, tool: tool.id }));
        else Object.assign(previous, meta);
      }
    }
    for (const name of files.keys()) if (!retained.has(name)) files.delete(name);
  }
  async function latestSignals(file) {
    // Tail reads give current task/limit state before older usage finishes indexing.
    const handle = await fs.open(file.path, 'r');
    try {
      const stat = await handle.stat(); file.size = stat.size; file.mtime = stat.mtimeMs;
      const size = Math.min(stat.size, 256 * 1024), start = stat.size - size;
      const buffer = Buffer.alloc(size); await handle.read(buffer, 0, size, start);
      const lines = buffer.toString('utf8').split('\n'); if (start) lines.shift();
      for (const line of lines) { try { ingest(file, JSON.parse(line), false); } catch { /* A final record may still be in flight. */ } }
    } finally { await handle.close(); }
  }
  async function readChunk(file, remaining) {
    const handle = await fs.open(file.path, 'r');
    try {
      const stat = await handle.stat();
      if (stat.size < file.offset) Object.assign(file, emptyFile({ path: file.path, tool: file.tool, size: stat.size, mtime: stat.mtimeMs }));
      file.size = stat.size; file.mtime = stat.mtimeMs;
      const count = Math.min(1024 * 1024, remaining, stat.size - file.offset);
      if (count <= 0) return 0;
      const buffer = Buffer.alloc(count); const { bytesRead } = await handle.read(buffer, 0, count, file.offset);
      file.offset += bytesRead;
      const text = file.carry + file.decoder.write(buffer.subarray(0, bytesRead));
      const lines = text.split('\n'); file.carry = lines.pop();
      if (file.carry.length > 2 * 1024 * 1024) { file.carry = ''; file.partial = true; }
      for (const line of lines) { try { ingest(file, JSON.parse(line)); } catch { if (line.trim()) file.partial = true; } }
      if (file.offset === stat.size && file.carry) {
        try { ingest(file, JSON.parse(file.carry)); file.carry = ''; } catch { /* Appended partial records are retried with the next chunk. */ }
      }
      await new Promise(resolve => setImmediate(resolve));
      return bytesRead;
    } finally { await handle.close(); }
  }
  function aggregate(now) {
    let partial = false;
    const tools = [];
    for (const definition of TOOLS) {
      if (!detected.has(definition.id)) continue;
      const sourceFiles = [...files.values()].filter(file => file.tool === definition.id);
      const deduplicated = new Map();
      let latestQuota = null;
      for (const file of sourceFiles) {
        const records = definition.id === 'codex' && !file.hasModern ? file.oldRecords : file.records;
        for (const [id, value] of records) {
          const key = definition.id === 'codex' && !file.hasModern ? file.session + ':' + id : id;
          const before = deduplicated.get(key);
          if (!before || value.tokens > before.tokens) deduplicated.set(key, value);
        }
        if (file.quota && (!latestQuota || file.quota.at > latestQuota.at)) latestQuota = file.quota;
      }
      const mixedLegacy = sourceFiles.some(file => file.hasModern && [...file.oldRecords.values()].some(record => record.tokens > 0 && record.timestamp < file.firstModernAt - 5000));
      const incomplete = mixedLegacy || discoveryPartial.has(definition.id) || sourceFiles.some(file => file.partial || file.offset < file.size);
      partial ||= incomplete;
      const activity = new Map(); let totalTokens = 0;
      for (const entry of deduplicated.values()) {
        totalTokens += entry.tokens;
        if (entry.timestamp >= now - historyDays * DAY && entry.timestamp <= now + 60000) {
          const date = day(entry.timestamp); activity.set(date, (activity.get(date) || 0) + entry.tokens);
        }
      }
      const roots = sourceFiles.filter(file => !file.subagent);
      const sorted = (roots.length ? roots : sourceFiles).sort((a, b) => b.latest - a.latest);
      const current = sorted[0];
      const recent = current && now - current.latest <= 5 * 60000 && current.latest <= now + 60000;
      const running = recent && definition.id === 'codex' && current.started > current.completed;
      const quota = definition.id === 'codex' ? quotaSnapshot(latestQuota, now) : null;
      const notes = [];
      if (mixedLegacy) notes.push('旧版与新版用量记录混合，部分旧记录未合并');
      if (discoveryPartial.has(definition.id)) notes.push('仅索引最近 ' + maxFiles + ' 个会话，统计不含全部历史');
      if (sourceFiles.some(file => file.partial || file.offset < file.size)) notes.push('正在增量读取最近记录，当前统计不完整');
      if (!quota) notes.push(latestQuota ? '额度快照已过期，等待工具更新' : '未提供可读取的额度数据');
      if (!deduplicated.size) notes.push('尚未读到 Token 用量');
      tools.push({ id: definition.id, name: definition.name, provider: current?.provider || null,
        status: running ? 'running' : recent ? 'recent' : current ? 'idle' : 'unknown',
        task: current?.task || null, taskUpdatedAt: current?.taskTime ? new Date(current.taskTime).toISOString() : null,
        todayTokens: activity.has(day(now)) ? activity.get(day(now)) : incomplete || !deduplicated.size ? null : 0, totalTokens: deduplicated.size ? totalTokens : null,
        activity: [...activity].sort(([a], [b]) => a.localeCompare(b)).map(([date, tokens]) => ({ date, tokens })),
        quota, source: '本地可读会话记录累计 · 最近 ' + historyDays + ' 天修改的记录', note: notes.join('；') || null });
    }
    return { updatedAt: new Date(now).toISOString(), tools, historyDays, partial };
  }
  async function refresh(now) {
    await discover(now);
    for (const definition of TOOLS) {
      const latest = [...files.values()].filter(file => file.tool === definition.id).sort((a, b) => b.mtime - a.mtime).slice(0, 4);
      for (const file of latest) { try { await latestSignals(file); } catch { file.partial = true; } }
    }
    // Interleave tools so a large Codex history cannot starve Claude or Pi.
    const groups = TOOLS.map(tool => [...files.values()].filter(file => file.tool === tool.id).sort((a, b) => b.mtime - a.mtime));
    const list = [];
    for (let index = 0; index < Math.max(0, ...groups.map(group => group.length)); index++)
      for (const group of groups) if (group[index]) list.push(group[index]);
    let budget = readBudget, visited = 0;
    const prioritized = new Set();
    // Reserve half the budget for fresh files, half for older unindexed history.
    for (const file of list.slice(0, 9)) {
      if (budget <= readBudget / 2) break;
      try { budget -= await readChunk(file, Math.min(budget - readBudget / 2, 1024 * 1024)); prioritized.add(file.path); }
      catch { file.partial = true; }
    }
    while (list.length && budget > 0 && visited < list.length) {
      const file = list[cursor % list.length]; cursor = (cursor + 1) % list.length; visited++;
      if (prioritized.has(file.path)) continue;
      try { budget -= await readChunk(file, budget); } catch { file.partial = true; }
    }
    cached = aggregate(now); lastRead = now; return clone(cached);
  }
  return {
    async getState() {
      if (disposed) throw new Error('AI 状态服务已关闭');
      if (!['live', 'readonly', 'mock'].includes(mode)) throw new Error('未知 AI 数据模式，已停止读取');
      const now = nowFn();
      // Mock mode must not even enumerate the user's home directory.
      if (mode === 'mock') return clone(options.mockState || mockState(now));
      if (cached && now - lastRead < cacheMs) return clone(cached);
      if (!pending) pending = refresh(now).finally(() => { pending = null; });
      return clone(await pending);
    },
    dispose() { disposed = true; files.clear(); cached = null; },
  };
}
module.exports = { createAiTools };
