'use strict';
const { _electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'touchbar-music-test-'));
const token = 'a'.repeat(64);
const fixture = { sessions: [{ token, source: 'Fixture Player', title: '深夜电台', artist: '模拟歌手', album: '本地测试', duration: 240, position: 45, playing: false, rate: 1, seekable: true, minSeek: 0, maxSeek: 240, current: true }] };
let app;
(async () => {
  try {
    const env = { ...process.env, TOUCH_BAR_DATA_DIR: data, TOUCH_BAR_CONTROLS_MODE: 'mock', TOUCH_BAR_AI_MODE: 'mock', TOUCH_BAR_MUSIC_MODE: 'mock' }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: process.env.TOUCH_BAR_TEST_EXECUTABLE || require('electron'), args: process.env.TOUCH_BAR_TEST_EXECUTABLE ? [] : [root], env });
    const page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.locator('#music-button').waitFor();
    await app.evaluate(({ ipcMain }, state) => {
      globalThis.__music = state; globalThis.__seeks = []; globalThis.__seekFails = false;
      for (const name of ['music:state', 'music:lyrics', 'music:seek']) ipcMain.removeHandler(name);
      ipcMain.handle('music:state', () => globalThis.__music);
      ipcMain.handle('music:lyrics', () => ({ status: 'synced', source: '模拟 LRC', lines: [{ time: 0, text: '这是模拟歌词，仅用于界面测试' }, { time: 40, text: '让音乐轻轻流过这一刻' }, { time: 120, text: '下一句测试歌词' }] }));
      ipcMain.handle('music:seek', (_e, t, seconds) => { if (globalThis.__seekFails) throw new Error('Fixture player rejected seek'); globalThis.__seeks.push({ token: t, seconds }); globalThis.__music.sessions[0].position = seconds; return { accepted: true }; });
    }, fixture);
    const controls = await page.evaluate(() => window.touchbar.getControls());
    await page.evaluate(() => window.musicView.refresh());
    await expect(page.locator('#music-panel')).toBeVisible();
    await expect(page.locator('.music-lyric')).toHaveText('让音乐轻轻流过这一刻');
    await expect(page.locator('.music-progress')).toBeHidden();
    await page.locator('.music-summary').click();
    await expect(page.locator('.music-progress')).toBeVisible();
    await expect(page.locator('#brightness-button')).toBeHidden();
    await expect(page.locator('#music-button')).toBeVisible();
    const output = path.join(root, 'release-local/screenshots'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'music-horizontal.png'), omitBackground: true });
    await page.locator('.music-slider').dispatchEvent('pointerdown');
    await page.locator('.music-slider').evaluate(el => { el.value = '130'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await app.evaluate(() => globalThis.__seeks.length), 0, 'drag preview never seeks');
    await page.locator('.music-slider').dispatchEvent('change');
    await expect.poll(() => app.evaluate(() => globalThis.__seeks.length)).toBe(1);
    await expect(page.locator('.music-lyric')).toHaveText('下一句测试歌词');
    // A changed song cancels an in-progress drag.
    await page.locator('.music-slider').dispatchEvent('pointerdown');
    await app.evaluate(() => { globalThis.__music.sessions[0].token = 'b'.repeat(64); });
    await page.evaluate(() => window.musicView.refresh());
    await page.locator('.music-slider').dispatchEvent('change');
    assert.equal(await app.evaluate(() => globalThis.__seeks.length), 1);
    // Player rejection remains visible and does not retry a seek.
    await app.evaluate(() => { globalThis.__seekFails = true; });
    await page.locator('.music-slider').dispatchEvent('pointerdown');
    await page.locator('.music-slider').evaluate(el => { el.value = '150'; el.dispatchEvent(new Event('input')); });
    await page.locator('.music-slider').dispatchEvent('change');
    await expect(page.locator('.music-lyric')).toContainText('未接受跳转');
    assert.equal(await app.evaluate(() => globalThis.__seeks.length), 1);
    await app.evaluate(() => { globalThis.__seekFails = false; globalThis.__music.sessions.push({ ...globalThis.__music.sessions[0], token: 'c'.repeat(64), source: 'Browser fixture', title: '模拟网页视频', seekable: false }); });
    await page.evaluate(() => window.musicView.refresh());
    await expect(page.locator('.music-source')).toBeVisible();
    await page.locator('.music-source').selectOption('c'.repeat(64));
    await expect(page.locator('.music-title')).toContainText('模拟网页视频');
    await expect(page.locator('.music-slider')).toBeDisabled();
    await page.locator('.music-source').selectOption('b'.repeat(64));
    await expect(page.locator('.music-title')).toContainText('深夜电台');
    // Browsing, passive polling and switching panels never control playback/audio.
    await page.locator('#music-panel').dispatchEvent('wheel', { deltaY: 120 });
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), controls);
    await page.locator('#ai-button').click(); await expect(page.locator('#music-panel')).toBeHidden();
    await page.locator('#music-button').click(); await expect(page.locator('#ai-panel')).toBeHidden();
    await app.evaluate(() => { globalThis.__music.sessions[0].seekable = false; });
    await page.evaluate(() => window.musicView.refresh()); await expect(page.locator('.music-slider')).toBeDisabled();
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.removeAllListeners('move'); w.removeAllListeners('moved'); w.setBounds({ x: 20, y: 80, width: 68, height: 750 }); w.webContents.send('touchbar:layout', { orientation: 'vertical', edge: 'left', scale: .72 }); });
    await expect(page.locator('.music-slider')).toHaveAttribute('aria-orientation', 'vertical');
    const bounds = await page.locator('#music-panel').boundingBox(); assert.ok(bounds.width <= 40.1);
    const extent = await page.locator('#music-panel').evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight })); assert.ok(extent.scroll <= extent.height + 2, 'vertical lyrics, seek bar and import button fit without hidden overflow'); await page.screenshot({ path: path.join(output, 'music-vertical.png'), omitBackground: true });
    await app.evaluate(() => { globalThis.__music.sessions = []; }); await page.evaluate(() => window.musicView.refresh());
    await expect(page.locator('.music-lyric')).toContainText('未检测到媒体');
    await expect(page.locator('.music-progress')).toBeHidden();
    await page.keyboard.press('Escape'); await expect(page.locator('#music-panel')).toBeHidden();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, realPlaybackWrites: false, realAudioWrites: false, screenshots: output }));
  } finally {
    await app?.close();
    if (path.resolve(data).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(data).startsWith('touchbar-music-test-')) fs.rmSync(data, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
