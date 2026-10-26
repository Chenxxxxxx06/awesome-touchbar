"use strict";
const { BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");
const { createWidgets } = require("./widgets.cjs");
function createWidgetManager({ bar, app, getLayout }) {
  let editor = null,
    closing = false;
  const store = createWidgets({
    file: path.join(app.getPath("userData"), "widget-components.json"),
    onChange: (state) => {
      for (const window of [bar, editor])
        if (
          window &&
          !window.isDestroyed() &&
          !window.webContents.isDestroyed()
        )
          window.webContents.send("widgets:changed", state);
    },
  });
  function fromWindow(event) {
    if (
      event.sender !== bar.webContents &&
      (!editor || editor.isDestroyed() || event.sender !== editor.webContents)
    )
      throw new Error("Unknown widget window");
  }
  function fromEditor(event) {
    if (!editor || editor.isDestroyed() || event.sender !== editor.webContents)
      throw new Error("Unknown widget editor");
  }
  function open() {
    if (editor && !editor.isDestroyed()) {
      editor.focus();
      return;
    }
    store.begin();
    const b = bar.getBounds(),
      area = screen.getDisplayMatching(b).workArea,
      orientation = getLayout().orientation;
    const width = Math.min(400, area.width - 20),
      height = Math.min(610, area.height - 20);
    let x = b.x + (b.width - width) / 2,
      y = b.y + b.height + 6;
    if (orientation === "vertical") {
      x = b.x + b.width + 6;
      y = b.y + 20;
      if (x + width > area.x + area.width) x = b.x - width - 6;
    } else if (y + height > area.y + area.height) y = b.y - height - 6;
    x = Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width)));
    y = Math.round(
      Math.max(area.y, Math.min(y, area.y + area.height - height)),
    );
    editor = new BrowserWindow({
      x,
      y,
      width,
      height,
      parent: bar,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#27272b",
      title: "自定义 Touch Bar",
      webPreferences: {
        preload: path.join(__dirname, "widgets-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: false,
      },
    });
    editor.setAlwaysOnTop(true, "screen-saver");
    editor.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    editor.webContents.on("will-navigate", (e) => e.preventDefault());
    editor.once("ready-to-show", () => editor?.show());
    editor.on("closed", () => {
      editor = null;
      if (!closing) store.cancel();
    });
    editor.loadFile(path.join(__dirname, "../ui/widgets-editor.html"));
  }
  ipcMain.handle("widgets:get", (e) => {
    fromWindow(e);
    return store.getState();
  });
  ipcMain.handle("widgets:open", (e) => {
    if (e.sender !== bar.webContents) throw new Error("Unknown bar");
    open();
  });
  ipcMain.handle("widgets:preview", (e, value) => {
    fromWindow(e);
    return store.preview(value);
  });
  ipcMain.handle("widgets:preset", (e, id) => {
    fromWindow(e);
    return store.applyPreset(id);
  });
  ipcMain.handle("widgets:savePreset", (e, name) => {
    fromEditor(e);
    return store.savePreset(name);
  });
  ipcMain.handle("widgets:deletePreset", (e, id) => {
    fromEditor(e);
    return store.deletePreset(id);
  });
  ipcMain.handle("widgets:finish", (e, save) => {
    fromWindow(e);
    if (typeof save !== "boolean") throw new Error("Invalid finish");
    const value = save ? store.commit() : store.cancel();
    closing = true;
    editor?.close();
    closing = false;
    return value;
  });
  return {
    open,
    getState: store.getState,
    setCatalog: store.setCatalog,
    menuItems: () => [
      { label: "自定义组件…", click: open },
      {
        label: "布局预设",
        submenu: [
          ...store.getState().builtins,
          ...store.getState().presets,
        ].map((p) => ({
          label: p.name,
          type: "radio",
          checked: store.getState().activePreset === p.id,
          click: () => {
            try {
              store.applyPreset(p.id);
            } catch {
              open();
            }
          },
        })),
      },
    ],
    dispose() {
      closing = true;
      editor?.close();
      editor = null;
    },
  };
}
module.exports = { createWidgetManager };
