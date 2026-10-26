'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProductivity } = require('../desktop/productivity.cjs');
function fixture() { let now = 1800000000000; const events = []; const service = createProductivity({ now: () => now, onNotice: item => events.push(item) }); return { service, events, advance: ms => { now += ms; service.tick(); }, now: () => now }; }
test('todos validate, edit, complete and restore; due reminders are emitted once', () => {
  const f = fixture(); const p = f.service;
  assert.throws(() => p.action('todo.save', { text: ' ' }));
  assert.throws(() => p.action('todo.save', { text: 'x', dueAt: NaN }));
  const id = p.action('todo.save', { text: '第一件事', dueAt: f.now() + 1000 }).todos[0].id;
  f.advance(1001); assert.equal(f.events.length, 1); f.advance(1000); assert.equal(f.events.length, 1);
  p.action('todo.toggle', { id }); assert.equal(p.getState().todos[0].done, true);
  p.action('todo.toggle', { id }); assert.equal(p.getState().todos[0].done, false); assert.equal(f.events.length, 1);
  p.action('todo.save', { id, text: '更新后的事项', dueAt: f.now() + 1000 }); f.advance(1001); assert.equal(f.events.length, 2);
  p.action('todo.delete', { id }); assert.equal(p.getState().todos.length, 0); assert.throws(() => p.action('todo.toggle', { id }));
});
test('timer pauses without clock drift, resumes and completes exactly once', () => {
  const f = fixture(), p = f.service;
  p.action('focus.start', { minutes: 1 }); f.advance(10000); p.action('focus.pause');
  f.advance(120000); assert.equal(p.getState().focus.remainingMs, 50000); assert.equal(f.events.length, 0);
  p.action('focus.resume'); f.advance(50000); assert.equal(p.getState().focus.status, 'completed'); assert.equal(f.events.length, 1);
  f.advance(120000); assert.equal(f.events.length, 1); assert.equal(p.getState().focus.completed, 1);
  p.action('focus.reset'); assert.equal(p.getState().focus.status, 'idle'); assert.equal(f.events.length, 1);
  for (const minutes of [0, -1, 181, NaN, 1.2, '25']) assert.throws(() => p.action('focus.start', { minutes }));
});
test('persistent state survives restart; overdue reminders are not duplicated', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'touchbar-productivity-'));
  const file = path.join(directory, 'state.json'); let now = 1800000000000;
  try {
    let p = createProductivity({ file, now: () => now }); p.action('todo.save', { text: 'Restart fixture', dueAt: now + 1000 }); p.action('focus.start', { minutes: 1 }); p.dispose();
    now += 65000; p = createProductivity({ file, now: () => now }); assert.equal(p.getState().notices.length, 2); p.dispose();
    p = createProductivity({ file, now: () => now }); assert.equal(p.getState().notices.length, 2); p.action('notice.readAll'); assert.equal(p.getState().unread, 0); p.dispose();
    const bad = '{broken'; fs.writeFileSync(file, bad); p = createProductivity({ file }); assert.match(p.getState().error, /原文件/); assert.throws(() => p.action('todo.save', { text: 'Do not overwrite' })); assert.equal(fs.readFileSync(file, 'utf8'), bad); p.dispose();
  } finally { const safe = path.resolve(directory); if (safe.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(safe).startsWith('touchbar-productivity-')) fs.rmSync(safe, { recursive: true, force: true }); }
});
test('notification settings, explicit read and deletion retain accurate badges', () => {
  const f = fixture(), p = f.service;
  assert.equal(p.getState().settings.desktop, false);
  p.action('todo.save', { text: 'Due', dueAt: f.now() }); const state = p.getState(); assert.equal(state.unread, 1);
  p.action('notice.read', { id: state.notices[0].id }); assert.equal(p.getState().unread, 0);
  p.action('settings.desktop', { enabled: true }); assert.equal(p.getState().settings.desktop, true);
  p.action('notice.delete', { id: state.notices[0].id }); assert.equal(p.getState().notices.length, 0);
});
test('AI notifications require a new, fresh state transition and never assert success', () => {
  const f = fixture(), p = f.service;
  const snapshot = (status, offset = 0) => ({ partial: false, tools: [{ id: 'codex', name: 'Codex', status, taskUpdatedAt: new Date(f.now() + offset).toISOString() }] });
  p.observeAI(snapshot('idle')); assert.equal(f.events.length, 0);
  p.observeAI(snapshot('running')); f.advance(1000); p.observeAI(snapshot('recent')); assert.equal(f.events.length, 1); assert.match(f.events[0].body, /不代表任务成功/);
  p.observeAI(snapshot('recent')); assert.equal(f.events.length, 1);
  p.observeAI(snapshot('running')); f.advance(1000); p.observeAI({ ...snapshot('idle'), partial: true }); assert.equal(f.events.length, 1);
  p.observeAI(snapshot('idle', -3600000)); assert.equal(f.events.length, 1);
});
