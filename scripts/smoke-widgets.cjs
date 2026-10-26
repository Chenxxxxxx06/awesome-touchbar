'use strict';
const { _electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(__dirname, '..'), data = fs.mkdtempSync(path.join(os.tmpdir(), 'touchbar-widgets-ui-'));
let app;
async function launch() {
  const env = { ...process.env, TOUCH_BAR_DATA_DIR: data, TOUCH_BAR_CONTROLS_MODE: 'mock', TOUCH_BAR_AI_MODE: 'mock', TOUCH_BAR_MUSIC_MODE: 'mock' }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: process.env.TOUCH_BAR_TEST_EXECUTABLE || require('electron'), args: process.env.TOUCH_BAR_TEST_EXECUTABLE ? [] : [root], env });
  const page = await app.firstWindow(); await expect(page.locator('#volume-button')).toBeEnabled(); await expect.poll(() => page.evaluate(() => window.touchbar.getWidgets().then(s => s.catalog.length))).toBe(19); return page;
}
async function open(page) { const promise = app.waitForEvent('window'); await page.locator('#customize-button').click(); const editor = await promise; await expect(editor.locator('.row')).toHaveCount(19); return editor; }
async function drag(page, from, to, vertical = false) {
  await page.locator(`#components [data-widget="${from}"]`).scrollIntoViewIfNeeded();
  const a = await page.locator(`#components [data-widget="${from}"]`).boundingBox(), b = await page.locator(`#components [data-widget="${to}"]`).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width * (vertical ? .5 : .8), b.y + b.height * (vertical ? .8 : .5), { steps: 8 }); await page.mouse.up();
}
(async () => {
  try {
    let page = await launch(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    const original = await page.evaluate(() => window.touchbar.getControls());
    // Long-press mute must enter editing without muting, and the main process
    // must reject control writes even if a renderer bypasses click interception.
    const editorPromise = app.waitForEvent('window'); const mute = await page.locator('#mute-button').boundingBox();
    await page.mouse.move(mute.x + mute.width / 2, mute.y + mute.height / 2); await page.mouse.down();
    let editor = await editorPromise; await page.mouse.up(); await expect(editor.locator('.row')).toHaveCount(19);
    await expect(page.locator('body')).toHaveAttribute('data-widget-editing', 'true');
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), original);
    for (const [method, args] of [['setVolume', [99, original.audio.deviceId]], ['setMuted', [true, original.audio.deviceId]], ['runAction', ['mediaPlayPause']]]) {
      assert.equal(await page.evaluate(async ([method, args]) => { try { await window.touchbar[method](...args); return false; } catch { return true; } }, [method, args]), true);
    }
    await page.locator('#components [data-widget="volumeUp"]').evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 })); el.click(); });
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), original);
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('body')).toHaveAttribute('data-widget-editing', 'false');
    editor = await open(page); await editor.getByRole('button', { name: '工作布局', exact: true }).click();
    await editor.locator('[data-id="todo"] .pin').click(); await expect(editor.locator('[data-id="todo"] .pin')).toHaveAttribute('aria-pressed', 'false');
    await editor.locator('[data-id="todo"] .visible').click(); await expect(editor.locator('[data-id="todo"]')).toHaveAttribute('data-hidden', 'true');
    await editor.locator('[data-id="todo"] .pin').click(); await expect(editor.locator('[data-id="todo"]')).toHaveAttribute('data-hidden', 'false');
    await editor.getByRole('button', { name: '上移待办事项', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.touchbar.getWidgets().then(s => s.layout.order[0]))).toBe('todo');
    await drag(page, 'todo', 'ai'); await expect.poll(() => page.evaluate(() => window.touchbar.getWidgets().then(s => s.layout.order[0]))).toBe('ai');
    await editor.locator('#preset-name').fill('我的工作台'); await editor.getByRole('button', { name: '保存预设', exact: true }).click(); await expect(editor.locator('#custom')).not.toHaveValue('');
    const output = path.join(root, 'release-local/screenshots'); fs.mkdirSync(output, { recursive: true }); await editor.screenshot({ path: path.join(output, 'widgets-editor.png') });
    await editor.locator('#done').click(); await page.locator('.expand').click();
    await expect(page.locator('.compact-controls #todo-button')).toBeVisible(); await expect(page.locator('#volume-button')).toBeHidden();
    await page.screenshot({ path: path.join(output, 'widgets-work-horizontal.png'), omitBackground: true });
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'widget-components.json'), 'utf8')); assert.equal(saved.presets.length, 1);
    // Cancel a preset change, and closing the editor via OS, preserve saved layout.
    editor = await open(page); await editor.getByRole('button', { name: '听歌布局', exact: true }).click(); await editor.locator('#cancel').click();
    assert.deepEqual((await page.evaluate(() => window.touchbar.getWidgets())).layout, saved.layout);
    editor = await open(page); await editor.getByRole('button', { name: '极简布局', exact: true }).click(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '自定义 Touch Bar').close());
    await expect(page.locator('body')).toHaveAttribute('data-widget-editing', 'false'); assert.deepEqual((await page.evaluate(() => window.touchbar.getWidgets())).layout, saved.layout);
    await app.close(); app = null;
    fs.writeFileSync(path.join(data, 'widget-layout.json'), JSON.stringify({edge:'left',scale:.72,y:80}));
    page = await launch(); assert.deepEqual((await page.evaluate(() => window.touchbar.getWidgets())).layout, saved.layout);
    await expect(page.locator('body')).toHaveAttribute('data-orientation','vertical');
    editor = await open(page);
    await drag(page, 'ai', 'todo', true);
    await expect.poll(() => page.evaluate(() => window.touchbar.getWidgets().then(s => s.layout.order[0]))).toBe('todo');
    // Every component can be pinned; overflow must scroll instead of increasing thickness.
    await page.evaluate(async () => { const s = await window.touchbar.getWidgets(); await window.touchbar.previewWidgets({ order: s.layout.order, hidden: [], pinned: s.layout.order }); });
    await editor.locator('#done').click(); await page.locator('.expand').click();
    const dimensions = await page.locator('.compact-controls').evaluate(el => ({ h: el.clientHeight, content: el.scrollHeight, w: el.getBoundingClientRect().width })); assert.ok(dimensions.content > dimensions.h && dimensions.w === 32);
    await page.locator('.compact-controls').evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, shiftKey: true })));
    assert.ok(await page.locator('.compact-controls').evaluate(el => el.scrollTop > 0));
    await page.locator('#volume-button').evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 })));
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), original, 'a continuous pinned-strip browsing gesture cannot become a volume change');
    await page.screenshot({ path: path.join(output, 'widgets-pins-vertical.png'), omitBackground: true });
    editor = await open(page); await page.evaluate(async () => { const s = await window.touchbar.getWidgets(); await window.touchbar.previewWidgets({ order: s.layout.order, hidden: s.layout.order, pinned: [] }); }); await editor.locator('#done').click();
    await expect(page.locator('#customize-button')).toBeVisible(); editor = await open(page); await editor.getByRole('button', { name: '恢复原布局', exact: true }).click(); await editor.locator('#done').click();
    assert.equal((await page.evaluate(() => window.touchbar.getWidgets())).layout.hidden.length, 0); assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), original); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, realDeviceWrites: false, checked: ['long press safety', 'horizontal and vertical drag', 'hide and pin', 'custom presets', 'cancel and window close', 'restart persistence', 'overflow scrolling', 'all hidden recovery'], output }));
  } finally { await app?.close(); const safe = path.resolve(data); if (safe.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(safe).startsWith('touchbar-widgets-ui-')) fs.rmSync(safe, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });



