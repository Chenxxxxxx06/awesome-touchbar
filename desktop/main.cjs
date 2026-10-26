'use strict';
const { app, BrowserWindow, Menu, screen, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { normalizeLayout, place, edgeAfterMove, publicLayout } = require('./layout.cjs');
const { createControls } = require('./controls.cjs');
app.setName('Touch Bar');
app.setAppUserModelId('local.touchbar.preview');
if (process.env.TOUCH_BAR_DATA_DIR) app.setPath('userData', path.resolve(process.env.TOUCH_BAR_DATA_DIR));
let bar;
let controls;
let layout = normalizeLayout();
let dragging = false;
let applyingBounds = false;
let lastAppliedBounds;
let settleTimer;
const layoutFile = path.join(app.getPath('userData'), 'widget-layout.json');

function readLayout() {
  try {
    if (fs.statSync(layoutFile).size <= 8192) layout = normalizeLayout(JSON.parse(fs.readFileSync(layoutFile, 'utf8')));
  } catch { /* First run starts at the top center. */ }
}
function persist() {
  if (!bar || bar.isDestroyed()) return;
  const bounds = bar.getBounds();
  layout = { ...layout, x: bounds.x, y: bounds.y };
  try {
    fs.mkdirSync(path.dirname(layoutFile), { recursive: true });
    fs.writeFileSync(layoutFile + '.tmp', JSON.stringify(layout, null, 2), 'utf8');
    fs.renameSync(layoutFile + '.tmp', layoutFile);
  } catch { /* A read-only profile must not stop the visible widget. */ }
}
function sendLayout() {
  if (bar && !bar.isDestroyed() && !bar.webContents.isDestroyed())
    bar.webContents.send('touchbar:layout', publicLayout(layout));
}
function keepOnTop() {
  if (!bar || bar.isDestroyed() || !bar.isVisible()) return;
  // Windows floating levels reinsert behind the taskbar and can lose topmost.
  // moveTop uses SWP_NOACTIVATE, so typing remains in the user's active app.
  bar.setAlwaysOnTop(true, 'screen-saver');
  bar.moveTop();
}
function currentDisplay() {
  return bar ? screen.getDisplayMatching(bar.getBounds()) : screen.getPrimaryDisplay();
}
function sameBounds(a, b) {
  return b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
function apply(next, display, center, save = true) {
  layout = normalizeLayout({ ...next, displayId: display.id });
  applyingBounds = true;
  try {
    bar.setBounds(place(display.workArea, layout, center));
    lastAppliedBounds = bar.getBounds();
  } finally { applyingBounds = false; }
  sendLayout();
  if (save) persist();
}
function finishMove() {
  clearTimeout(settleTimer);
  if (dragging || applyingBounds || !bar || bar.isDestroyed()) return;
  const bounds = bar.getBounds();
  if (sameBounds(bounds, lastAppliedBounds)) return;
  const display = screen.getDisplayMatching(bounds);
  const edge = edgeAfterMove(bounds, display.workArea, layout.orientation);
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  apply({ ...layout, edge }, display, center);
}
function queueFinish(delay = 180) {
  clearTimeout(settleTimer);
  if (!dragging && !applyingBounds && bar && !bar.isDestroyed() && !sameBounds(bar.getBounds(), lastAppliedBounds))
    settleTimer = setTimeout(finishMove, delay);
}
function changeScale(scale) {
  const bounds = bar.getBounds();
  apply({ ...layout, scale }, currentDisplay(), { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
}
function showMenu() {
  Menu.buildFromTemplate([
    { label: '长度', submenu: [[0.6, '紧凑 (60%)'], [0.72, '标准 (72%)'], [0.84, '加长 (84%)']].map(([scale, label]) => ({
      label, type: 'radio', checked: layout.scale === scale, click: () => changeScale(scale),
    })) },
    { type: 'separator' },
    { label: '退出 Touch Bar', click: () => app.quit() },
  ]).popup({ window: bar });
}
function adaptDisplay() {
  if (!bar || bar.isDestroyed() || dragging) return;
  const display = currentDisplay();
  const bounds = bar.getBounds();
  apply(layout, display, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (bar && !bar.isDestroyed()) bar.showInactive(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    readLayout();
    const display = screen.getAllDisplays().find(item => item.id === layout.displayId) || screen.getPrimaryDisplay();
    layout.displayId = display.id;
    bar = new BrowserWindow({
      ...place(display.workArea, layout), frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: false, resizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, title: 'Touch Bar',
      icon: path.join(__dirname, '../assets/icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'), sandbox: true,
        contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false,
      },
    });
    lastAppliedBounds = bar.getBounds();
    bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    bar.webContents.on('will-navigate', event => event.preventDefault());
    bar.webContents.session.setPermissionRequestHandler((_wc, _permission, done) => done(false));
    ipcMain.handle('touchbar:state', event => {
      if (event.sender !== bar.webContents) throw new Error('Unknown window');
      return publicLayout(layout);
    });
    controls = createControls({ onChange: state => {
      if (bar && !bar.isDestroyed() && !bar.webContents.isDestroyed())
        bar.webContents.send('controls:changed', state);
    } });
    const fromBar = event => {
      if (!bar || bar.isDestroyed() || event.sender !== bar.webContents) throw new Error('Unknown window');
    };
    ipcMain.handle('controls:get', event => { fromBar(event); return controls.getState(); });
    for (const [channel, method] of [['controls:volume', 'setVolume'], ['controls:brightness', 'setBrightness']]) {
      ipcMain.handle(channel, (event, value, deviceId) => {
        fromBar(event);
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
          throw new Error('Expected a percentage between 0 and 100');
        if (method === 'setVolume' && (typeof deviceId !== 'string' || !deviceId || deviceId.length > 256))
          throw new Error('Audio device changed; reopen the control');
        return controls[method](value, deviceId);
      });
    }
    ipcMain.handle('controls:muted', (event, value, deviceId) => {
      fromBar(event);
      if (typeof value !== 'boolean') throw new Error('Expected a mute state');
      if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 256)
        throw new Error('Audio device changed; reopen the control');
      return controls.setMuted(value, deviceId);
    });
    bar.webContents.on('context-menu', showMenu);
    bar.on('system-context-menu', event => { event.preventDefault(); showMenu(); });
    bar.webContents.on('did-finish-load', sendLayout);
    bar.on('move', () => queueFinish());
    bar.on('moved', () => queueFinish(30));
    if (process.platform === 'win32') {
      // Native CSS dragging enters a Windows move loop. Never rotate mid-drag.
      bar.hookWindowMessage(0x0231, () => { dragging = true; clearTimeout(settleTimer); });
      bar.hookWindowMessage(0x0232, () => { dragging = false; queueFinish(0); });
    }
    bar.on('show', () => setImmediate(keepOnTop));
    bar.on('blur', () => setImmediate(keepOnTop));
    bar.once('ready-to-show', () => { bar.showInactive(); keepOnTop(); });
    bar.on('closed', () => { clearTimeout(settleTimer); bar = null; });
    bar.loadFile(path.join(__dirname, '../ui/index.html'));
    screen.on('display-metrics-changed', adaptDisplay);
    screen.on('display-removed', adaptDisplay);
    screen.on('display-added', adaptDisplay);
  });
}
app.on('before-quit', () => { persist(); controls?.dispose(); });
app.on('window-all-closed', () => app.quit());
