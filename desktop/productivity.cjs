'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const clone = value => structuredClone(value);
const initial = () => ({ version: 1, todos: [], notices: [], settings: { desktop: false }, focus: { status: 'idle', durationMs: 25 * 60000, remainingMs: 25 * 60000, endAt: null, completed: 0 } });
const finite = x => typeof x === 'number' && Number.isFinite(x);
function createProductivity(options = {}) {
  const now = options.now || (() => Date.now()), file = options.file;
  let data = initial(), loadError = '', disposed = false;
  const aiPrevious = new Map();
  if (file) {
    try {
      if (fs.statSync(file).size > 1024 * 1024) throw new Error('Too large');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      const validTodo = t => t && typeof t.id === 'string' && typeof t.text === 'string' && t.text.length <= 160 && typeof t.done === 'boolean' && (t.dueAt === null || finite(t.dueAt)) && (t.notifiedAt === null || finite(t.notifiedAt));
      const validNotice = n => n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.body === 'string' && typeof n.read === 'boolean' && ['todo', 'focus', 'ai', 'diy'].includes(n.kind) && finite(n.createdAt);
      if (saved.version !== 1 || !Array.isArray(saved.todos) || saved.todos.length > 200 || !saved.todos.every(validTodo) || !Array.isArray(saved.notices) || saved.notices.length > 100 || !saved.notices.every(validNotice) || !['idle', 'running', 'paused', 'completed'].includes(saved.focus?.status) || !finite(saved.focus.durationMs) || saved.focus.durationMs < 60000 || saved.focus.durationMs > 180 * 60000 || !finite(saved.focus.remainingMs) || saved.focus.remainingMs < 0 || saved.focus.remainingMs > saved.focus.durationMs || !Number.isInteger(saved.focus.completed) || saved.focus.completed < 0 || (saved.focus.status === 'running' && !finite(saved.focus.endAt)) || typeof saved.settings?.desktop !== 'boolean') throw new Error('Invalid data');
      data = saved;
    } catch (error) { if (error.code !== 'ENOENT') loadError = '本地待办文件无法读取，已保留原文件；暂不能保存更改'; }
  }
  function snapshot() {
    const result = clone(data);
    result.focus.remainingMs = data.focus.status === 'running' ? Math.max(0, data.focus.endAt - now()) : data.focus.remainingMs;
    result.unread = data.notices.filter(n => !n.read).length;
    result.error = loadError; result.now = now(); return result;
  }
  function commit(change) {
    if (disposed || loadError) throw new Error(loadError || 'Service closed');
    const next = clone(data), events = [];
    change(next, events);
    if (file) {
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(next), 'utf8'); fs.renameSync(file + '.tmp', file); }
      catch { throw new Error('无法保存到本机，请检查存储空间与目录权限'); }
    }
    data = next;
    try { options.onChange?.(snapshot()); } catch {}
    for (const event of events) { try { options.onNotice?.(clone(event), data.settings.desktop); } catch {} }
    return snapshot();
  }
  function notify(next, events, kind, title, body, targetId = null) {
    const entry = { id: randomUUID(), kind, title, body, targetId, createdAt: now(), read: false };
    next.notices.unshift(entry); next.notices.length = Math.min(next.notices.length, 100); events.push(entry);
  }
  function tick() {
    if (disposed || loadError) return snapshot();
    const due = data.todos.some(t => !t.done && t.dueAt !== null && t.dueAt <= now() && t.notifiedAt === null);
    const finished = data.focus.status === 'running' && data.focus.endAt <= now();
    if (!due && !finished) return snapshot();
    return commit((next, events) => {
      for (const todo of next.todos) if (!todo.done && todo.dueAt !== null && todo.dueAt <= now() && todo.notifiedAt === null) { todo.notifiedAt = now(); notify(next, events, 'todo', '待办到时间了', todo.text, todo.id); }
      if (finished) { next.focus.status = 'completed'; next.focus.endAt = null; next.focus.remainingMs = 0; next.focus.completed++; notify(next, events, 'focus', '这一段专注完成了', `${Math.round(next.focus.durationMs / 60000)} 分钟已结束，休息一下吧。`); }
    });
  }
  const find = (next, id) => { const item = next.todos.find(t => t.id === id); if (!item) throw new Error('这条待办已不存在'); return item; };
  function action(op, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('无效参数');
    tick();
    return commit((next, events) => {
      if (op === 'todo.save') {
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        if (!text || text.length > 160) throw new Error('待办需要 1–160 个字符');
        const dueAt = args.dueAt ?? null;
        if (dueAt !== null && (!finite(dueAt) || dueAt < 0 || dueAt > now() + 10 * 366 * 86400000)) throw new Error('提醒时间无效');
        if (args.id !== null && args.id !== undefined) {
          const item = find(next, args.id); if (item.dueAt !== dueAt) item.notifiedAt = null; item.text = text; item.dueAt = dueAt;
        } else {
          if (next.todos.length >= 200) throw new Error('最多保存 200 条待办，请先整理已完成事项');
          next.todos.unshift({ id: randomUUID(), text, dueAt, done: false, createdAt: now(), notifiedAt: null });
        }
      } else if (op === 'todo.toggle') { const item = find(next, args.id); item.done = !item.done; }
      else if (op === 'todo.delete') { find(next, args.id); next.todos = next.todos.filter(t => t.id !== args.id); }
      else if (op === 'focus.start') {
        if (next.focus.status === 'running') return;
        const minutes = args.minutes;
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw new Error('专注时间需为 1–180 分钟');
        next.focus = { ...next.focus, status: 'running', durationMs: minutes * 60000, remainingMs: minutes * 60000, endAt: now() + minutes * 60000 };
      } else if (op === 'focus.pause') { if (next.focus.status === 'running') { next.focus.remainingMs = Math.max(0, next.focus.endAt - now()); next.focus.endAt = null; next.focus.status = 'paused'; } }
      else if (op === 'focus.resume') { if (next.focus.status === 'paused') { next.focus.endAt = now() + next.focus.remainingMs; next.focus.status = 'running'; } }
      else if (op === 'focus.reset') { next.focus.status = 'idle'; next.focus.endAt = null; next.focus.remainingMs = next.focus.durationMs; }
      else if (op === 'notice.read') { const item = next.notices.find(n => n.id === args.id); if (item) item.read = true; }
      else if (op === 'notice.readAll') { for (const n of next.notices) n.read = true; }
      else if (op === 'notice.delete') { next.notices = next.notices.filter(n => n.id !== args.id); }
      else if (op === 'settings.desktop') { if (typeof args.enabled !== 'boolean') throw new Error('无效设置'); next.settings.desktop = args.enabled; }
      else throw new Error('未知操作');
    });
  }
  return {
    getState: tick, action, tick,
    addDIY(notice) { return commit((next, events) => notify(next, events, 'diy', String(notice.title).slice(0,40), String(notice.body).slice(0,160), String(notice.id).slice(0,48))); },
    observeAI(snapshot) {
      if (!snapshot || snapshot.partial || !Array.isArray(snapshot.tools) || disposed || loadError) return;
      for (const tool of snapshot.tools) {
        if (!['codex', 'claude', 'pi'].includes(tool.id) || !['running', 'recent', 'idle'].includes(tool.status)) continue;
        const before = aiPrevious.get(tool.id);
        const fresh = typeof tool.taskUpdatedAt === 'string' && now() - Date.parse(tool.taskUpdatedAt) >= 0 && now() - Date.parse(tool.taskUpdatedAt) < 15 * 60000;
        // A recorded running -> idle/recent change is not proof of task success.
        if (before?.status === 'running' && tool.status !== 'running' && fresh && tool.taskUpdatedAt !== before.updatedAt) {
          commit((next, events) => notify(next, events, 'ai', `${String(tool.name || tool.id).slice(0, 40)} 状态变化`, '本地记录已离开运行状态，点击查看。此提醒不代表任务成功。', tool.id));
        }
        aiPrevious.set(tool.id, { status: tool.status, updatedAt: tool.taskUpdatedAt });
      }
    },
    dispose() { disposed = true; aiPrevious.clear(); },
  };
}
module.exports = { createProductivity };
