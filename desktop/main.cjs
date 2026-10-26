'use strict';
const { app, BrowserWindow, Menu, screen, ipcMain, dialog, net, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { normalizeLayout, place, edgeAfterMove, publicLayout } = require('./layout.cjs');
const { createControls, CONTROL_ACTIONS } = require('./controls.cjs');
const { createAiTools } = require('./ai-tools.cjs');
const { createMusic } = require('./music.cjs');
const { createLyrics } = require('./lyrics.cjs');
const { createDiyManager } = require('./diy-manager.cjs');
const { createWidgetManager } = require('./widget-manager.cjs');
const { createProductivity } = require('./productivity.cjs');
app.setName('Touch Bar');
app.setAppUserModelId('local.touchbar.preview');
if (process.env.TOUCH_BAR_DATA_DIR) app.setPath('userData', path.resolve(process.env.TOUCH_BAR_DATA_DIR));
let bar;
let controls;
let widgetManager;
let diyManager;
let aiTools;
let music;
let lyrics;
let productivity, productivityTimer, aiReminderTimer, todoEditor, todoDraft;
const notificationObjects = new Set();
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
    ...(widgetManager?.menuItems() || []),
    { type: 'separator' },
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
    widgetManager = createWidgetManager({ bar, app, getLayout: () => layout });
    const allowControl = () => { if (widgetManager.getState().editing) throw new Error('组件编辑中，已暂停快捷操作'); };
    controls = createControls({ onChange: state => {
      if (bar && !bar.isDestroyed() && !bar.webContents.isDestroyed())
        bar.webContents.send('controls:changed', state);
    } });
    const fromBar = event => {
      if (!bar || bar.isDestroyed() || event.sender !== bar.webContents) throw new Error('Unknown window');
    };
    productivity = createProductivity({
      file: path.join(app.getPath('userData'), 'productivity.json'),
      onChange: state => { if (bar && !bar.isDestroyed()) bar.webContents.send('productivity:changed', state); },
      onNotice: (notice, enabled) => {
        if (!enabled || process.env.TOUCH_BAR_CONTROLS_MODE === 'mock' || !Notification.isSupported()) return;
        try {
          const notification = new Notification({ title: notice.title, body: notice.kind === 'todo' ? '有一条待办到时间了，点击在 Touch Bar 查看。' : notice.body, silent: true });
          notificationObjects.add(notification);
          notification.on('click', () => { if (bar && !bar.isDestroyed()) { bar.showInactive(); bar.webContents.send('productivity:open', 'notices'); } });
          notification.on('close', () => notificationObjects.delete(notification));
          notification.on('failed', () => notificationObjects.delete(notification));
          notification.show();
        } catch { /* The persistent in-bar inbox remains available if Windows suppresses a toast. */ }
      },
    });
    diyManager = createDiyManager({ app, bar, widgets: widgetManager, productivity });
    productivityTimer = setInterval(() => { try { productivity.tick(); } catch { /* A later user action shows storage errors. */ } }, 1000);
    ipcMain.handle('productivity:get', event => { fromBar(event); return productivity.getState(); });
    ipcMain.handle('productivity:action', (event, op, payload) => { fromBar(event); return productivity.action(op, payload); });
    ipcMain.handle('productivity:edit', (event, id) => {
      fromBar(event);
      if (id !== null && typeof id !== 'string') throw new Error('Invalid todo');
      if (todoEditor && !todoEditor.isDestroyed()) { todoEditor.focus(); return; }
      const item = id === null ? { id: null, text: '', dueAt: null } : productivity.getState().todos.find(t => t.id === id);
      if (!item) throw new Error('Todo not found');
      todoDraft = { id: item.id, text: item.text, dueAt: item.dueAt };
      const b = bar.getBounds(), area = screen.getDisplayMatching(b).workArea, width = 340, height = 282;
      let x = b.x + (b.width - width) / 2, y = b.y + b.height + 6;
      if (layout.edge === 'left') { x = b.x + b.width + 6; y = b.y + 40; }
      if (layout.edge === 'right') { x = b.x - width - 6; y = b.y + 40; }
      if (y + height > area.y + area.height) y = b.y - height - 6;
      x = Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width)));
      y = Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height)));
      todoEditor = new BrowserWindow({ x, y, width, height, parent: bar, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, show: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#27272a', title: 'Touch Bar 待办', webPreferences: { preload: path.join(__dirname, 'todo-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
      todoEditor.setAlwaysOnTop(true, 'screen-saver');
      todoEditor.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      todoEditor.webContents.on('will-navigate', e => e.preventDefault());
      todoEditor.once('ready-to-show', () => todoEditor?.show());
      todoEditor.on('closed', () => { todoEditor = null; todoDraft = null; });
      todoEditor.loadFile(path.join(__dirname, '../ui/todo-editor.html'));
    });
    const fromEditor = event => { if (!todoEditor || todoEditor.isDestroyed() || event.sender !== todoEditor.webContents) throw new Error('Unknown editor'); };
    ipcMain.handle('todo-editor:draft', event => { fromEditor(event); return todoDraft; });
    ipcMain.handle('todo-editor:save', (event, payload) => {
      fromEditor(event);
      if (!payload || typeof payload !== 'object') throw new Error('Invalid todo');
      productivity.action('todo.save', { id: todoDraft.id, text: payload.text, dueAt: payload.dueAt });
      todoEditor.close();
    });
    ipcMain.handle('todo-editor:close', event => { fromEditor(event); todoEditor.close(); });
    aiTools = createAiTools();
    let aiReminderPending = false;
    aiReminderTimer = setInterval(async () => {
      if (aiReminderPending) return; aiReminderPending = true;
      try { productivity.observeAI(await aiTools.getState()); } catch {} finally { aiReminderPending = false; }
    }, 30000);
    music = createMusic();
    lyrics = createLyrics({ directory: path.join(app.getPath('userData'), 'music-lyrics'), mock: music.mode === 'mock', fetch: (url, options) => net.fetch(String(url), options) });
    const findTrack = async token => {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid song');
      const state = await music.getState();
      const matching = state.sessions.filter(track => track.token === token);
      if (matching.length !== 1) throw new Error('Song changed');
      return matching[0];
    };
    ipcMain.handle('music:state', event => { fromBar(event); return music.getState(); });
    ipcMain.handle('music:seek', (event, token, seconds) => { fromBar(event); allowControl(); return music.seek(token, seconds); });
    ipcMain.handle('music:lyrics', async (event, token) => { fromBar(event); return lyrics.load(await findTrack(token)); });
    ipcMain.handle('music:import', async (event, token) => {
      fromBar(event);
      const track = await findTrack(token);
      if (music.mode === 'mock') return null;
      const selected = await dialog.showOpenDialog(bar, { title: '导入当前歌曲的同步歌词', properties: ['openFile'], filters: [{ name: 'LRC 歌词', extensions: ['lrc'] }] });
      if (selected.canceled || selected.filePaths.length !== 1) return null;
      const file = selected.filePaths[0];
      if (path.extname(file).toLowerCase() !== '.lrc' || (await fs.promises.stat(file)).size > 1024 * 1024) throw new Error('Invalid LRC file');
      await findTrack(token);
      return lyrics.import(track, await fs.promises.readFile(file, 'utf8'));
    });
    ipcMain.handle('ai:state', async event => { fromBar(event); const state = await aiTools.getState(); try { productivity.observeAI(state); } catch {} return state; });
    ipcMain.handle('controls:get', event => { fromBar(event); return controls.getState(); });
    ipcMain.handle('controls:action', (event, action) => {
      fromBar(event);
      if (typeof action !== 'string' || !CONTROL_ACTIONS.includes(action)) throw new Error('Unknown widget action');
      allowControl();
      return controls.runAction(action);
    });
    for (const [channel, method] of [['controls:volume', 'setVolume'], ['controls:brightness', 'setBrightness']]) {
      ipcMain.handle(channel, (event, value, deviceId) => {
        fromBar(event);
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
          throw new Error('Expected a percentage between 0 and 100');
        if (method === 'setVolume' && (typeof deviceId !== 'string' || !deviceId || deviceId.length > 256))
          throw new Error('Audio device changed; reopen the control');
        allowControl();
        return controls[method](value, deviceId);
      });
    }
    ipcMain.handle('controls:muted', (event, value, deviceId) => {
      fromBar(event);
      if (typeof value !== 'boolean') throw new Error('Expected a mute state');
      if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 256)
        throw new Error('Audio device changed; reopen the control');
      allowControl();
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
    bar.on('closed', () => { clearTimeout(settleTimer); todoEditor?.close(); bar = null; app.quit(); });
    bar.loadFile(path.join(__dirname, '../ui/index.html'));
    screen.on('display-metrics-changed', adaptDisplay);
    screen.on('display-removed', adaptDisplay);
    screen.on('display-added', adaptDisplay);
  });
}
app.on('before-quit', () => { persist(); diyManager?.dispose(); widgetManager?.dispose(); clearInterval(productivityTimer); clearInterval(aiReminderTimer); productivity?.dispose(); for (const notification of notificationObjects) notification.close(); controls?.dispose(); aiTools?.dispose(); music?.dispose(); lyrics?.dispose(); });
app.on('window-all-closed', () => app.quit());
