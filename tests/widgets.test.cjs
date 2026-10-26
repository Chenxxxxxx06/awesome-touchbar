'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createWidgets, validateLayout, CATALOG } = require('../desktop/widgets.cjs');
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touchbar-widgets-unit-')); t.after(() => { if (path.basename(dir).startsWith('touchbar-widgets-unit-') && path.dirname(dir) === path.resolve(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true }); }); return path.join(dir, 'widget-components.json'); }
test('draft changes preview but cancel preserves disk; commit survives restart', t => {
  const file = temp(t), store = createWidgets({ file }); store.applyPreset('work'); const before = fs.readFileSync(file, 'utf8');
  store.begin(); const layout = store.getState().layout; layout.order.reverse(); layout.hidden.push('todo'); layout.pinned = layout.pinned.filter(id => id !== 'todo'); store.preview(layout);
  assert.equal(fs.readFileSync(file, 'utf8'), before); store.cancel(); assert.equal(store.getState().activePreset, 'work');
  store.begin(); store.preview(layout); store.savePreset('我的工作台'); store.commit();
  const loaded = createWidgets({ file }).getState(); assert.deepEqual(loaded.layout, validateLayout(layout)); assert.equal(loaded.presets[0].name, '我的工作台'); assert.equal(loaded.editing, false);
});
test('all hidden is recoverable; invalid layouts cannot overwrite the draft', () => {
  const store = createWidgets(); store.begin(); const layout = store.getState().layout;
  store.preview({ ...layout, hidden: CATALOG.map(c => c.id), pinned: [] }); assert.equal(store.getState().layout.hidden.length, CATALOG.length);
  const before = store.getState(); assert.throws(() => store.preview({ ...layout, order: ['volume'] })); assert.throws(() => store.preview({ ...layout, hidden: ['ai'] })); assert.deepEqual(store.getState(), before);
  store.applyPreset('default'); assert.equal(store.getState().layout.hidden.length, 0);
});
test('named presets are isolated snapshots, unique, bounded and deletable without losing active layout', () => {
  const store = createWidgets(); store.begin(); store.applyPreset('music'); store.savePreset('通勤'); const first = store.getState().presets[0];
  store.applyPreset('work'); assert.deepEqual(store.getState().presets[0], first); store.applyPreset(first.id); store.deletePreset(first.id); assert.deepEqual(store.getState().layout, first.layout);
  assert.throws(() => store.savePreset('工作')); assert.throws(() => store.savePreset(' '));
  for (let i = 0; i < 12; i++) store.savePreset('布局 ' + i); assert.throws(() => store.savePreset('超过上限'));
});
test('corrupt storage remains untouched and cannot be silently replaced', t => {
  const file = temp(t); fs.writeFileSync(file, '{broken'); const store = createWidgets({ file }); assert.ok(store.getState().error); store.begin(); store.applyPreset('minimal'); assert.throws(() => store.commit()); assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
