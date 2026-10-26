'use strict';
const { _electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'touchbar-layout-test-'));
const output = process.env.TOUCH_BAR_SCREENSHOT_DIR || path.join(root, 'release', 'screenshots');
const screenshot = {
  horizontal: path.join(output, 'touchbar-horizontal.png'),
  vertical: path.join(output, 'touchbar-vertical.png'),
  slider: path.join(output, 'touchbar-slider.png'),
  verticalError: path.join(output, 'touchbar-vertical-error.png'),
  expanded: path.join(output, 'touchbar-expanded.png'),
  expandedVertical: path.join(output, 'touchbar-expanded-vertical.png'),
};
const errors = [];
(async () => {
  const env = { ...process.env, TOUCH_BAR_DATA_DIR: data, TOUCH_BAR_CONTROLS_MODE: 'mock' };
  assert.equal(env.TOUCH_BAR_CONTROLS_MODE, 'mock', 'desktop tests never write real audio or brightness');
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.TOUCH_BAR_TEST_EXECUTABLE || require('electron');
  let app;
  let page;
  async function launch() {
    app = await _electron.launch({ executablePath, args: process.env.TOUCH_BAR_TEST_EXECUTABLE ? [] : [root], env, timeout: 30000 });
    page = await app.firstWindow();
    page.on('pageerror', e => errors.push(e.message));
    await page.locator('.touch-bar').waitFor();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), { timeout: 5000 }).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => {
      window.__layoutEvents = [];
      window.__unsubscribeLayout = window.touchbar.onLayout(value => window.__layoutEvents.push(value));
    });
  }
  async function move(edge) {
    // Changed native bounds plus the actual moved event exercise finishMove.
    // This deliberately avoids IPC docking shortcuts and internal apply gates.
    await app.evaluate(({ BrowserWindow, screen }, edge) => {
      const w = BrowserWindow.getAllWindows()[0];
      const b = w.getBounds();
      const a = screen.getDisplayMatching(b).workArea;
      let x = Math.round(a.x + (a.width - b.width) / 2);
      let y = Math.round(a.y + (a.height - b.height) / 2);
      if (edge === 'left') x = a.x;
      if (edge === 'right') x = a.x + a.width - b.width;
      if (edge === 'top') y = a.y;
      w.setBounds({ x, y, width: b.width, height: b.height });
      w.emit('moved');
    }, edge);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getLayout()).edge), { timeout: 5000 }).toBe(edge);
    const orientation = ['left', 'right'].includes(edge) ? 'vertical' : 'horizontal';
    await expect(page.locator('body')).toHaveAttribute('data-orientation', orientation);
    await expect(page.locator('body')).toHaveAttribute('data-edge', edge);
    const dimensions = await page.locator('.touch-bar').boundingBox();
    assert.ok(orientation === 'vertical' ? dimensions.height > dimensions.width : dimensions.width > dimensions.height);
    const transforms = await page.locator('svg').evaluateAll(elements => elements.map(el => getComputedStyle(el).transform));
    assert.ok(transforms.every(value => value === 'none'), 'icons stay upright in both orientations');
    return dimensions;
  }
  try {
    fs.mkdirSync(output, { recursive: true });
    await launch();
    await expect(page.locator('.compact-controls button')).toHaveCount(3);
    await expect(page.locator('#components')).toBeHidden();
    await expect(page.locator('.expand')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#adjustment')).toBeHidden();
    await expect(page.getByRole('button', { name: /Siri/i })).toHaveCount(0);
    const layout = await page.evaluate(() => window.touchbar.getLayout());
    assert.deepEqual(layout, { orientation: 'horizontal', edge: 'top', scale: 0.72 });
    const native = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const all = BrowserWindow.getAllWindows();
      const w = all[0];
      const image = await w.webContents.capturePage();
      const preferences = w.webContents.getLastWebPreferences();
      return { windows: all.length, alwaysOnTop: w.isAlwaysOnTop(), bounds: w.getBounds(), area: screen.getDisplayMatching(w.getBounds()).workArea, cornerAlpha: image.toBitmap()[3], sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration };
    });
    assert.equal(native.windows, 1);
    assert.equal(native.alwaysOnTop, true);
    assert.equal(native.cornerAlpha, 0);
    assert.equal(native.sandbox, true);
    assert.equal(native.nodeIntegration, false);
    assert.equal(native.bounds.y, native.area.y, 'default is top docked');
    const horizontal = await page.locator('.touch-bar').boundingBox();
    assert.equal(horizontal.height, 40);
    assert.ok(Math.abs(horizontal.width - Math.round(native.area.width * 0.72)) <= 1, '72% width within one DIP of Windows DPI rounding');
    const radius = await page.locator('.touch-bar').evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    assert.equal(radius, 8, 'subtle 8px outer corners');
    const keyRadius = await page.locator('.key').first().evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    assert.equal(keyRadius, 5, 'subtle 5px key corners');
    // This entire app runs in mock mode: pointer/keyboard checks cannot touch real audio.
    const initialControls = await page.evaluate(() => window.touchbar.getControls());
    assert.deepEqual(initialControls.audio, { available: true, volume: 25, muted: false, deviceId: 'mock-default' });
    await expect(page.locator('#mute-button')).toBeEnabled();
    const range = page.locator('#adjustment-slider');
    const components = page.locator('#components');
    const expandedBrightness = '#components [data-adjust="brightness"]:not([data-step])';
    const expandedVolume = '#components [data-adjust="volume"]:not([data-step])';
    const wheel = async (selector, deltaY, deltaMode = 0, deltaX = 0) => {
      const target = page.locator(selector);
      const box = await target.boundingBox();
      assert.ok(box, 'wheel target must be visible');
      const pointer = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
      // Ordinary calls are independent user intentions. Explicit movement makes
      // them distinct from the stationary continuous-gesture regression below.
      await target.dispatchEvent('pointermove', { ...pointer, clientX: pointer.clientX + 8, bubbles: true });
      await target.dispatchEvent('pointermove', { ...pointer, bubbles: true });
      await target.dispatchEvent('wheel', { ...pointer, deltaY, deltaX, deltaMode, bubbles: true, cancelable: true });
    };
    await page.locator('.expand').click();
    await expect(page.locator('body')).toHaveAttribute('data-expanded', 'true');
    await expect(page.locator('.expand')).toHaveAttribute('aria-expanded', 'true');
    await expect(components).toBeVisible();
    await expect(page.locator('.compact-controls')).toBeHidden();
    await expect(page.locator('#adjustment')).toBeHidden();
    assert.ok(await components.locator('button').count() >= 10, 'expanded strip reveals additional usable controls');
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), initialControls, 'expansion only reveals controls');
    const expandedBox = await components.boundingBox();
    const spaceBox = await page.locator('.empty-space').boundingBox();
    assert.ok(Math.abs(expandedBox.width - spaceBox.width) <= 2, 'expanded components fill the available bar');
    await page.screenshot({ path: screenshot.expanded, omitBackground: true, animations: 'disabled' });
    const actions = ['mediaPrevious', 'mediaPlayPause', 'mediaNext', 'showDesktop', 'taskView', 'openExplorer'];
    for (const action of actions) {
      const button = page.locator(`#components [data-action="${action}"]`);
      await button.click();
      await expect(button).toHaveAttribute('aria-busy', 'false');
      assert.equal(await button.getAttribute('data-failed'), null, 'allowlisted action succeeds in mock mode: ' + action);
    }
    for (const action of ['', '__proto__', 'setVolume', 'mediaPlayPause;calc', 123, null]) {
      assert.equal(await page.evaluate(async action => {
        try { await window.touchbar.runAction(action); return false; } catch { return true; }
      }, action), true, 'renderer cannot invoke an arbitrary system action');
    }
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), initialControls, 'mock media and desktop actions preserve device state');
    // A short bar must expose overflow through its own viewport, without resizing
    // the native window or changing the user's saved dock/monitor preferences.
    await page.locator('.touch-bar').evaluate(el => { el.style.width = '340px'; });
    const horizontalOverflow = await components.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(horizontalOverflow.scroll > horizontalOverflow.client, 'narrow horizontal bar has reachable hidden components');
    await wheel('#components', -120);
    await expect.poll(() => components.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    assert.equal(await components.evaluate(el => el.scrollTop), 0);
    await wheel('#components', 120);
    await expect.poll(() => components.evaluate(el => el.scrollLeft)).toBe(0);
    await wheel('#components', -3, 1);
    await expect.poll(() => components.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await wheel('#components', -1, 2);
    const scrolled = await components.evaluate(el => ({ position: el.scrollLeft, end: el.scrollWidth - el.clientWidth }));
    assert.ok(scrolled.position >= 0 && scrolled.position <= scrolled.end, 'scrolling stays within viewport bounds');
    await components.evaluate(el => { el.scrollLeft = 0; });
    await page.locator(expandedBrightness).dispatchEvent('wheel', { deltaY: -120, shiftKey: true, bubbles: true, cancelable: true });
    await expect.poll(() => components.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await components.evaluate(el => { el.scrollLeft = 0; });
    await wheel('.expand', -120);
    await expect.poll(() => components.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), initialControls, 'navigating components does not change audio or brightness');
    // As content slides beneath a stationary pointer, the next wheel event may
    // target a volume button. That same gesture must remain navigation only.
    const gesture = await page.evaluate(() => {
      const viewport = document.querySelector('#components');
      const volume = viewport.querySelector('[data-adjust="volume"]:not([data-step])');
      const rect = viewport.getBoundingClientRect();
      const pointer = { clientX: rect.x + 15, clientY: rect.y + rect.height / 2 };
      viewport.scrollLeft = 0;
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: pointer.clientX + 8, bubbles: true }));
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...pointer, bubbles: true }));
      viewport.dispatchEvent(new WheelEvent('wheel', { ...pointer, deltaY: -120, bubbles: true, cancelable: true }));
      const first = viewport.scrollLeft;
      volume.dispatchEvent(new WheelEvent('wheel', { ...pointer, deltaY: -120, bubbles: true, cancelable: true }));
      return { pointer, first, second: viewport.scrollLeft };
    });
    assert.ok(gesture.second > gesture.first, 'volume under a stationary pointer continues the original browse gesture');
    await page.waitForTimeout(150); // Let a mistaken queued setter become observable.
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), initialControls, 'continuous browsing cannot turn into a volume adjustment');
    await page.locator(expandedVolume).dispatchEvent('wheel', { ...gesture.pointer, deltaY: 120, bubbles: true, cancelable: true });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), initialControls, 'reversing direction does not change the locked browsing route');
    await page.waitForTimeout(400);
    await page.locator(expandedVolume).dispatchEvent('wheel', { ...gesture.pointer, deltaY: -100, bubbles: true, cancelable: true });
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.volume)).toBe(27);
    await page.evaluate(() => window.touchbar.setVolume(25, 'mock-default'));
    await page.locator('.touch-bar').evaluate(el => { el.style.removeProperty('width'); });
    await components.evaluate(el => { el.scrollLeft = 0; });
    await page.locator(expandedBrightness).click();
    await expect(components).toBeHidden();
    await expect(range).toHaveAttribute('aria-label', '亮度');
    await expect(page.locator('body')).toHaveAttribute('data-expanded', 'true');
    await wheel('#adjustment-slider', -120);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).brightness.value)).toBe(62);
    await wheel('#adjustment-slider', 3, 1);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).brightness.value)).toBe(60);
    await wheel('#adjustment-slider', -1, 2);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).brightness.value)).toBe(62);
    assert.equal((await page.evaluate(() => window.touchbar.getControls())).audio.volume, 25, 'brightness wheel never changes audio');
    await page.locator('.close-adjustment').click();
    await expect(components).toBeVisible();
    await wheel(expandedVolume, -120);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.volume)).toBe(27);
    assert.equal((await page.evaluate(() => window.touchbar.getControls())).brightness.value, 62, 'volume wheel never changes brightness');
    // The value and mute state are independently controlled, including at limits.
    await page.evaluate(() => window.touchbar.setVolume(99, 'mock-default'));
    if (await components.isHidden()) await page.locator('.close-adjustment').click();
    await wheel(expandedVolume, -120);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.volume)).toBe(100);
    if (await components.isHidden()) await page.locator('.close-adjustment').click();
    await wheel(expandedVolume, -120);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.volume)).toBe(100);
    assert.equal((await page.evaluate(() => window.touchbar.getControls())).audio.muted, false);
    await page.evaluate(() => window.touchbar.setVolume(1, 'mock-default'));
    if (await components.isHidden()) await page.locator('.close-adjustment').click();
    await wheel(expandedVolume, 120);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.volume)).toBe(0);
    if (await components.isHidden()) await page.locator('.close-adjustment').click();
    await page.locator(expandedBrightness).click();
    await page.keyboard.press('Escape');
    await expect(components).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(components).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-expanded', 'false');
    await expect(page.locator('.compact-controls')).toBeVisible();
    await page.evaluate(async () => {
      await window.touchbar.setVolume(25, 'mock-default');
      await window.touchbar.setBrightness(60);
    });
    await page.locator('#volume-button').click();
    await expect(page.locator('#adjustment')).toBeVisible();
    await expect(range).toHaveValue('25');
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), initialControls, 'opening controls never changes settings');
    await range.focus();
    await range.press('ArrowRight');
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.volume)).toBe(26);
    const track = await range.boundingBox();
    await page.mouse.click(track.x + track.width * .75, track.y + track.height / 2);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.volume)).toBeGreaterThan(70);
    await range.evaluate(el => {
      for (const value of [10, 30, 44]) { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.volume)).toBe(44);
    await page.locator('#brightness-button').click();
    await expect(range).toHaveAttribute('aria-label', '亮度');
    await expect(range).toHaveValue('60');
    assert.equal(await page.locator('.brightness-symbol').getAttribute('hidden'), null);
    assert.notEqual(await page.locator('.volume-symbol').getAttribute('hidden'), null);
    await range.focus();
    await range.press('ArrowLeft');
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).brightness.value)).toBe(59);
    await page.screenshot({ path: screenshot.slider, omitBackground: true, animations: 'disabled' });
    await page.locator('#mute-button').click();
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.muted)).toBe(true);
    await expect(page.locator('#mute-button')).toHaveAttribute('aria-label', '取消静音');
    await expect(page.locator('.volume-cross')).toHaveCount(0);
    assert.equal(await page.locator('.volume-waves').getAttribute('hidden'), null, 'volume remains distinct from mute');
    await page.locator('#mute-button').click();
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.muted)).toBe(false);
    // External updates render without issuing a write back to the mock endpoint.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('controls:changed', {
      audio: { available: true, volume: 11, muted: false, deviceId: 'mock-default' }, brightness: { available: false, value: null, error: 'unsupported' }
    }));
    await expect(page.locator('.control-status')).toContainText('此屏幕暂不支持');
    await expect(range).toBeDisabled();
    await page.locator('#volume-button').click();
    await expect(range).toHaveValue('11');
    assert.equal((await page.evaluate(() => window.touchbar.getControls())).audio.volume, 44, 'external state does not feed back into writes');
    await app.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows()[0].webContents.send('controls:changed', state), await page.evaluate(() => window.touchbar.getControls()));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('controls:changed', {
      audio: { available: true, volume: 5, muted: false, deviceId: 'mock-replaced' }, brightness: { available: true, value: 59 }
    }));
    await expect(page.locator('.control-status')).toContainText('音频设备已切换');
    await expect(range).toBeDisabled();
    await range.evaluate(el => { el.value = '99'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await wheel('#adjustment-slider', -120);
    await wheel('#adjustment-slider', -3, 1);
    assert.equal((await page.evaluate(() => window.touchbar.getControls())).audio.volume, 44, 'an old gesture cannot change a replacement device');
    await app.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows()[0].webContents.send('controls:changed', state), await page.evaluate(() => window.touchbar.getControls()));
    await range.press('Escape');
    await expect(page.locator('#adjustment')).toBeHidden();
    // Capture the actual context-menu template without opening a native popup.
    const menuLabels = await app.evaluate(({ BrowserWindow, Menu }) => {
      const original = Menu.buildFromTemplate;
      let labels;
      Menu.buildFromTemplate = template => { labels = template.filter(item => item.label).map(item => item.label); return { popup() {} }; };
      try { BrowserWindow.getAllWindows()[0].webContents.emit('context-menu', {}); }
      finally { Menu.buildFromTemplate = original; }
      return labels;
    });
    assert.deepEqual(menuLabels, ['长度', '退出 Touch Bar']);
    for (const [method, value] of [['setVolume', -1], ['setVolume', 101], ['setBrightness', '50'], ['setMuted', 1]]) {
      assert.equal(await page.evaluate(async ([method, value]) => { try { await window.touchbar[method](value); return false; } catch { return true; } }, [method, value]), true, 'invalid control input is rejected');
    }
    // Exercise recovery without forcing foreground focus away from the user's app.
    const focusedBefore = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const focused = w.isFocused();
      w.setAlwaysOnTop(false);
      w.emit('blur');
      return focused;
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(true);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()), focusedBefore);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: screenshot.horizontal, omitBackground: true, animations: 'disabled' });
    const vertical = await move('left');
    const beforeVerticalNavigation = await page.evaluate(() => window.touchbar.getControls());
    await page.locator('.expand').click();
    await expect(components).toBeVisible();
    await page.screenshot({ path: screenshot.expandedVertical, omitBackground: true, animations: 'disabled' });
    await page.locator('.touch-bar').evaluate(el => { el.style.height = '360px'; });
    const verticalOverflow = await components.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight }));
    assert.ok(verticalOverflow.scroll > verticalOverflow.client, 'short vertical bar has reachable hidden components');
    await wheel('#components', -120);
    await expect.poll(() => components.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    assert.equal(await components.evaluate(el => el.scrollLeft), 0);
    await wheel('#components', 120);
    await expect.poll(() => components.evaluate(el => el.scrollTop)).toBe(0);
    await wheel('#components', -3, 1);
    await expect.poll(() => components.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    assert.deepEqual(await page.evaluate(() => window.touchbar.getControls()), beforeVerticalNavigation, 'vertical component navigation is read-only');
    await page.locator('.touch-bar').evaluate(el => { el.style.removeProperty('height'); });
    await page.locator('.expand').click();
    await expect(components).toBeHidden();
    await page.locator('#volume-button').click();
    await expect(page.locator('#adjustment-slider')).toHaveAttribute('aria-orientation', 'vertical');
    const verticalTrack = await range.boundingBox();
    assert.ok(verticalTrack.height > verticalTrack.width);
    await page.mouse.click(verticalTrack.x + verticalTrack.width / 2, verticalTrack.y + verticalTrack.height * .25);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.volume)).toBeGreaterThan(65);
    await page.mouse.click(verticalTrack.x + verticalTrack.width / 2, verticalTrack.y + verticalTrack.height * .75);
    await expect.poll(() => page.evaluate(async () => (await window.touchbar.getControls()).audio.volume)).toBeLessThan(35);
    await page.screenshot({ path: screenshot.vertical, omitBackground: true, animations: 'disabled' });
    await page.locator('.close-adjustment').click();
    // An injected failure in this mock-only app must offer a read-only retry.
    await app.evaluate(({ ipcMain }) => {
      globalThis.__brightnessAttempts = 0;
      ipcMain.removeHandler('controls:brightness');
      ipcMain.handle('controls:brightness', () => { globalThis.__brightnessAttempts++; throw new Error('Simulated device failure'); });
    });
    await expect(page.locator('#adjustment')).toBeHidden();
    await wheel('#brightness-button', -120);
    await expect(page.locator('#adjustment')).toBeVisible();
    await expect(range).toHaveAttribute('aria-label', '亮度');
    assert.equal(await page.locator('#brightness-button').getAttribute('data-wheel-value'), null, 'failed wheel change does not leave a simulated percentage');
    await expect(page.locator('.retry-control')).toBeVisible();
    await expect(page.locator('.retry-control')).toBeEnabled();
    await expect(range).toBeVisible();
    await expect(range).toBeDisabled();
    const retryBox = await page.locator('.retry-control').boundingBox();
    assert.ok(retryBox.width <= 28 && retryBox.height <= 38, 'vertical error stays compact');
    await page.screenshot({ path: screenshot.verticalError, omitBackground: true, animations: 'disabled' });
    const attempts = await app.evaluate(() => globalThis.__brightnessAttempts);
    assert.equal(attempts, 1);
    await page.locator('.retry-control').click();
    await expect(page.locator('.control-feedback')).toBeHidden();
    await expect(range).toBeEnabled();
    assert.equal(await app.evaluate(() => globalThis.__brightnessAttempts), attempts, 'retry reads state without repeating the failed write');
    await expect(range).toHaveValue('59');
    await page.locator('.close-adjustment').click();
    await move('right');
    await move('free');
    await move('top');
    const events = await page.evaluate(() => window.__layoutEvents);
    for (const edge of ['left', 'right', 'free', 'top']) assert.ok(events.some(event => event.edge === edge), 'onLayout publishes ' + edge);
    assert.ok(events.every(event => Object.keys(event).sort().join(',') === 'edge,orientation,scale'));
    const count = events.length;
    await page.evaluate(() => window.__unsubscribeLayout());
    await move('left');
    assert.equal(await page.evaluate(() => window.__layoutEvents.length), count, 'onLayout unsubscribe works');
    await app.close();
    app = null;
    const layoutFile = path.join(data, 'widget-layout.json');
    const saved = JSON.parse(fs.readFileSync(layoutFile, 'utf8'));
    assert.equal(saved.edge, 'left');
    assert.equal(saved.orientation, 'vertical');
    assert.equal(saved.scale, 0.72);
    assert.deepEqual(fs.readdirSync(data).filter(file => file.endsWith('.json')).sort(), ['widget-layout.json'], 'only the widget layout is app JSON state');
    assert.equal(fs.existsSync(layoutFile + '.tmp'), false);
    await launch();
    await expect(page.locator('body')).toHaveAttribute('data-orientation', 'vertical');
    assert.deepEqual(await page.evaluate(() => window.touchbar.getLayout()), { orientation: 'vertical', edge: 'left', scale: 0.72 });
    assert.equal(await page.evaluate(() => localStorage.length), 0, 'layout has no renderer storage copy');
    await move('top');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, controlsMode: 'mock', realDeviceWrites: false, horizontal, vertical, native, screenshot, checks: ['one top-docked window', 'topmost recovery on blur signal preserves focus', 'mock-only slider, mute, external sync and unavailable states', 'expanded components fill bar and close back to compact mode', 'horizontal/vertical wheel navigation and overflow bounds', 'Shift-wheel and arrow-wheel browse without setting changes', 'continuous browse gesture stays locked when volume scrolls under pointer', 'allowlisted media/desktop actions run only against mocks', 'wheel adjustments target brightness or volume and clamp at limits', 'device invalidation blocks slider wheel writes', 'failed wheel write reveals compact feedback and retry does not replay it', 'no directional context-menu items', 'rounded corners and native transparency', '72% work-area width', 'left/right vertical and free/top horizontal after moved', 'upright icons', 'preload getLayout/onLayout and unsubscribe', 'widget-layout.json persistence and restart', 'renderer sandbox and no exceptions'] }, null, 2));
  } finally {
    if (app) await app.close();
    const resolved = path.resolve(data);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('touchbar-layout-test-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
