'use strict';
const { _electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'touchbar-ai-test-'));
const output = path.join(root, 'release-local', 'screenshots');
const now = new Date();
const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const activity = Array.from({ length: 91 }, (_, i) => ({ date: day(new Date(+now - (90 - i) * 86400000)), tokens: i % 4 === 0 ? i * 1000 : 0 }));
const base = { provider: null, status: 'idle', task: null, taskUpdatedAt: null, todayTokens: 18000, totalTokens: 260000, activity, quota: null, source: '模拟本地会话', note: null };
const fixture = { updatedAt: now.toISOString(), historyDays: 91, partial: false, tools: [
  { ...base, id: 'codex', name: 'Codex', status: 'running', task: '为 Touch Bar 增加 AI 工具组件，并整理额度提醒、活动图和当前任务的显示，让横排与竖排都更易读', taskUpdatedAt: now.toISOString(), quota: { usedPercent: 82, remainingPercent: 18, updatedAt: now.toISOString(), resetAt: new Date(+now + 3600000).toISOString(), source: '5 小时限额快照' } },
  { ...base, id: 'claude', name: 'Claude Code', status: 'recent', task: '整理项目说明', quota: null },
  { ...base, id: 'pi', name: 'Pi', provider: 'DeepSeek', totalTokens: null, todayTokens: null, activity: [], quota: null },
] };
let app;
(async () => {
  try {
    fs.mkdirSync(output, { recursive: true });
    const env = { ...process.env, TOUCH_BAR_DATA_DIR: data, TOUCH_BAR_CONTROLS_MODE: 'mock', TOUCH_BAR_AI_MODE: 'mock' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: process.env.TOUCH_BAR_TEST_EXECUTABLE || require('electron'), args: process.env.TOUCH_BAR_TEST_EXECUTABLE ? [] : [root], env, timeout: 30000 });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#ai-button').waitFor();
    await app.evaluate(({ ipcMain }, state) => {
      globalThis.__aiFixture = state;
      globalThis.__aiFail = false;
      ipcMain.removeHandler('ai:state');
      ipcMain.handle('ai:state', () => { if (globalThis.__aiFail) throw new Error('Mock local read failure'); return globalThis.__aiFixture; });
    }, fixture);
    const initial = await page.evaluate(() => window.touchbar.getControls());
    const order = await page.locator('.expand, #ai-button, #brightness-button').evaluateAll(items => items.map(item => item.getBoundingClientRect().x));
    assert.ok(order[0] < order[1] && order[1] < order[2], 'AI icon is to the right of the expansion arrow');
    await expect.poll(() => page.locator('#ai-button img').evaluateAll(images => images.length === 1 && images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
    await page.locator('#ai-button').click();
    await expect(page.locator('#ai-panel .ai-overview')).toBeVisible();
    await expect(page.locator('.ai-tool-card')).toHaveCount(3);
    await expect(page.locator('#ai-button')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.ai-tool-card[data-tool-id="codex"] .ai-quota-ring')).toHaveAttribute('data-known', 'true');
    await expect(page.locator('.ai-tool-card[data-tool-id="claude"] .ai-quota-ring')).toHaveAttribute('data-known', 'false');
    await expect(page.locator('#ai-button .ai-alert-dot')).toBeVisible();
    await expect.poll(() => page.locator('.ai-tool-card img').evaluateAll(images => images.length === 3 && images.every(img => img.complete && img.naturalWidth > 0 && img.src.includes('/assets/brands/')))).toBe(true);
    const cards = await page.locator('.ai-tool-card').evaluateAll(items => items.map(item => item.getBoundingClientRect().width));
    assert.ok(Math.max(...cards) - Math.min(...cards) <= 2, 'tool overview divides the bar evenly');
    await page.screenshot({ path: path.join(output, 'ai-overview.png'), omitBackground: true });
    // A narrow bar can still browse and reach the final tool without losing navigation.
    await page.locator('.touch-bar').evaluate(el => { el.style.width = '440px'; });
    await page.locator('.ai-overview').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.locator('.ai-tool-card[data-tool-id="pi"]').click();
    await expect(page.locator('.ai-detail[data-tool-id="pi"]')).toBeVisible();
    assert.equal(await page.locator('.ai-detail').evaluate(el => el.scrollLeft), 0, 'new narrow detail starts at its back button');
    await expect(page.locator('.ai-back')).toBeVisible();
    await page.locator('.ai-back').click();
    await page.locator('.touch-bar').evaluate(el => { el.style.removeProperty('width'); });
    await page.locator('.ai-tool-card[data-tool-id="codex"]').click();
    await expect(page.locator('.ai-detail[data-tool-id="codex"]')).toBeVisible();
    await expect(page.locator('.ai-overview')).toBeHidden();
    await expect(page.locator('.ai-heatmap .ai-day')).toHaveCount(14);
    const square = await page.locator('.ai-day').first().boundingBox();
    assert.ok(Math.abs(square.width - square.height) < .2 && square.height >= 8 && square.height <= 11, 'recent-activity cells are readable larger squares');
    await expect(page.locator('.ai-task-text')).toContainText('Touch Bar');
    const taskType = await page.locator('.ai-task-text').evaluate(el => ({ font: parseFloat(getComputedStyle(el).fontSize), line: parseFloat(getComputedStyle(el).lineHeight), height: el.getBoundingClientRect().height }));
    assert.ok(taskType.font >= 12 && taskType.height > 0 && taskType.height <= taskType.line * 2 + 1, 'current task uses readable text within two lines');
    const panel = await page.locator('#ai-panel').boundingBox();
    assert.ok(panel.height >= 39 && panel.height <= 41, 'AI detail uses the preserved 40 DIP content area');
    await page.locator('#ai-panel').dispatchEvent('wheel', { deltaY: -120 });
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), initial, 'AI browsing does not modify brightness/audio');
    await page.screenshot({ path: path.join(output, 'ai-codex-detail.png'), omitBackground: true });
    await page.keyboard.press('Escape');
    await expect(page.locator('.ai-overview')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ai-panel')).toBeHidden();
    // Expanding another control and returning restores its own view without overlap.
    await page.locator('.expand').click();
    await page.locator('#ai-button').click();
    await expect(page.locator('#components')).toBeHidden();
    await page.locator('#ai-button').click();
    await expect(page.locator('#components')).toBeVisible();
    await page.locator('.expand').click();
    await page.locator('#brightness-button').click();
    await page.locator('#ai-button').click();
    await expect(page.locator('#adjustment')).toBeHidden();
    await expect(page.locator('#ai-panel')).toBeVisible();
    // Stale or missing quota cannot produce a confident remaining-budget ring.
    await app.evaluate(() => { globalThis.__aiFixture.tools[0].quota.updatedAt = new Date(Date.now() - 2 * 3600000).toISOString(); });
    await page.evaluate(() => window.aiToolsView.refresh());
    await expect(page.locator('.ai-tool-card[data-tool-id="codex"] .ai-quota-ring')).toHaveAttribute('data-fresh', 'false');
    await expect(page.locator('#ai-button .ai-alert-dot')).toBeHidden();
    await app.evaluate(() => { globalThis.__aiFixture.partial = true; globalThis.__aiFixture.tools[0].todayTokens = null; });
    await page.locator('.ai-tool-card[data-tool-id="codex"]').click();
    await page.evaluate(() => window.aiToolsView.refresh());
    await expect(page.locator('.ai-coverage')).toBeVisible();
    await expect(page.locator('.ai-metric-value[data-metric="today"]')).toHaveText('—');
    await page.keyboard.press('Escape');
    // Read failure retains honest feedback, and a later refresh can recover.
    await app.evaluate(() => { globalThis.__aiFail = true; });
    await page.evaluate(() => window.aiToolsView.refresh());
    await expect(page.locator('.ai-stale')).toBeVisible();
    assert.match(await page.locator('.ai-stale').getAttribute('title'), /失败.*上次/);
    await app.evaluate(() => { globalThis.__aiFail = false; });
    await page.evaluate(() => window.aiToolsView.refresh());
    // The same detail remains legible in a 48 DIP-wide vertical shell.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.removeAllListeners('move'); w.removeAllListeners('moved');
      w.setBounds({ x: 20, y: 80, width: 68, height: 750 });
      w.webContents.send('touchbar:layout', { orientation: 'vertical', edge: 'left', scale: .72 });
    });
    await expect(page.locator('body')).toHaveAttribute('data-orientation', 'vertical');
    await page.locator('#ai-panel').evaluate(el => { el.style.height = '220px'; });
    await page.locator('.ai-overview').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.locator('.ai-tool-card[data-tool-id="pi"]').click();
    assert.equal(await page.locator('.ai-detail').evaluate(el => el.scrollTop), 0, 'detail does not inherit overview scroll offset');
    await expect(page.locator('.ai-back')).toBeVisible();
    await page.locator('.ai-back').click();
    await page.locator('#ai-panel').evaluate(el => { el.style.removeProperty('height'); });
    await page.locator('.ai-tool-card[data-tool-id="codex"]').click();
    await expect(page.locator('.ai-detail')).toBeVisible();
    const vPanel = await page.locator('#ai-panel').boundingBox();
    assert.ok(vPanel.width >= 39 && vPanel.width <= 41, 'vertical AI view stays inside the existing bar width');
    await page.screenshot({ path: path.join(output, 'ai-codex-vertical.png'), omitBackground: true });
    await page.keyboard.press('Escape');
    await app.evaluate(() => { globalThis.__aiFixture.tools = []; });
    await page.evaluate(() => window.aiToolsView.refresh());
    await expect(page.locator('.ai-tool-card')).toHaveCount(0);
    assert.match(await page.locator('#ai-panel').innerText(), /未检测|未发现|没有/);
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), initial);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, aiMode: 'mock', realProfileReads: false, realDeviceWrites: false, output }));
  } finally {
    if (app) await app.close();
    const resolved = path.resolve(data);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('touchbar-ai-test-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
