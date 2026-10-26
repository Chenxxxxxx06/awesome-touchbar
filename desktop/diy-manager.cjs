"use strict";
const { BrowserWindow, ipcMain, dialog, shell, screen } = require("electron");
const fs = require("node:fs"),
  path = require("node:path");
const { createDIY } = require("./diy.cjs");
const { parseManifest, safeUrl } = require("./plugin-schema.cjs");
function createDiyManager({ app, bar, widgets, productivity }) {
  let composer = null,
    draft = null,
    signature = "";
  const diy = createDIY({
    directory: app.getPath("userData"),
    onChange: (state) => {
      if (!bar.isDestroyed() && !bar.webContents.isDestroyed())
        bar.webContents.send("diy:changed", state);
      const catalog = diy.catalog(),
        key = JSON.stringify(catalog);
      if (key !== signature) {
        signature = key;
        widgets.setCatalog(catalog);
      }
    },
    onNotice: (n) => productivity.addDIY(n),
  });
  widgets.setCatalog([
    ...diy.catalog(),
    ...widgets.getState().catalog.filter((x) => x.id === "diy"),
  ]);
  const timer = setInterval(() => {
    try {
      diy.tick();
    } catch {}
  }, 1000);
  const fromBar = (e) => {
    if (bar.isDestroyed() || e.sender !== bar.webContents)
      throw new Error("Unknown bar");
  };
  const fromComposer = (e) => {
    if (
      !composer ||
      composer.isDestroyed() ||
      e.sender !== composer.webContents
    )
      throw new Error("Unknown composer");
  };
  const writable = () => {
    if (widgets.getState().editing) throw new Error("请先完成组件布局编辑");
  };
  ipcMain.handle("diy:get", (e) => {
    fromBar(e);
    return diy.getState();
  });
  ipcMain.handle("diy:refresh", (e) => {
    fromBar(e);
    return diy.refresh(true);
  });
  ipcMain.handle("diy:start", (e, payload) => {
    fromBar(e);
    writable();
    return diy.start(payload);
  });
  ipcMain.handle("diy:cancel", (e) => {
    fromBar(e);
    return diy.cancel();
  });
  ipcMain.handle("diy:action", (e, id, op, arg) => {
    fromBar(e);
    writable();
    return diy.action(id, op, arg);
  });
  ipcMain.handle("diy:link", async (e, id, index) => {
    fromBar(e);
    writable();
    const m = diy.manifest(id);
    if (
      m.kind !== "links" ||
      !Number.isInteger(index) ||
      !m.config.links[index]
    )
      throw new Error("无效链接");
    const url = safeUrl(m.config.links[index].url);
    if (process.env.TOUCH_BAR_CONTROLS_MODE === "mock") return;
    await shell.openExternal(url);
  });
  ipcMain.handle("diy:community", (e) => {
    fromBar(e);
    if (process.env.TOUCH_BAR_CONTROLS_MODE !== "mock")
      return shell.openExternal(
        "https://github.com/Chenxxxxxx06/awesome-touchbar/tree/main/community",
      );
  });
  ipcMain.handle("diy:import", async (e) => {
    fromBar(e);
    writable();
    const result = await dialog.showOpenDialog(bar, {
      title: "导入 DIY 组件",
      properties: ["openFile"],
      filters: [{ name: "Touch Bar 组件", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 32768)
      throw new Error("组件文件不能超过 32 KB");
    return diy.install(parseManifest(fs.readFileSync(file, "utf8")));
  });
  ipcMain.handle("diy:export", async (e, id) => {
    fromBar(e);
    const m = diy.manifest(id);
    const result = await dialog.showSaveDialog(bar, {
      title: "导出组件：只包含定义，不含使用记录",
      defaultPath: path.join(app.getPath("downloads"), m.id + ".json"),
      filters: [{ name: "Touch Bar 组件", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    fs.writeFileSync(
      result.filePath,
      JSON.stringify(m, null, 2) + "\n",
      "utf8",
    );
    return { saved: true };
  });
  ipcMain.handle("diy:composer", (e, payload) => {
    fromBar(e);
    writable();
    if (composer && !composer.isDestroyed()) {
      composer.focus();
      return;
    }
    if (
      !payload ||
      typeof payload.toolId !== "string" ||
      !diy.getState().tools.some((t) => t.id === payload.toolId) ||
      typeof payload.model !== "string" ||
      payload.model.length > 120 ||
      typeof payload.request !== "string" ||
      payload.request.length > 4000
    )
      throw new Error("无效需求");
    draft = {
      toolId: payload.toolId,
      model: payload.model,
      request: payload.request,
      targetId: payload.targetId || null,
    };
    const b = bar.getBounds(),
      area = screen.getDisplayMatching(b).workArea,
      width = Math.min(420, area.width - 20),
      height = Math.min(340, area.height - 20);
    let x = b.width < 100 ? b.x + b.width + 8 : b.x + (b.width - width) / 2,
      y = b.width < 100 ? b.y : b.y + b.height + 8;
    if (x + width > area.x + area.width) x = b.x - width - 8;
    if (y + height > area.y + area.height) y = b.y - height - 8;
    x = Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width)));
    y = Math.round(
      Math.max(area.y, Math.min(y, area.y + area.height - height)),
    );
    composer = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      parent: bar,
      show: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#27272b",
      title: "DIY 组件",
      webPreferences: {
        preload: path.join(__dirname, "diy-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: false,
      },
    });
    composer.setAlwaysOnTop(true, "screen-saver");
    composer.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    composer.webContents.on("will-navigate", (e) => e.preventDefault());
    composer.once("ready-to-show", () => composer?.show());
    composer.on("closed", () => {
      composer = null;
      draft = null;
    });
    composer.loadFile(path.join(__dirname, "../ui/diy-composer.html"));
  });
  ipcMain.handle("diy:composerGet", (e) => {
    fromComposer(e);
    return { draft, tools: diy.getState().tools };
  });
  ipcMain.handle("diy:composerStart", (e, payload) => {
    fromComposer(e);
    writable();
    return diy.start({ ...payload, targetId: draft.targetId });
  });
  ipcMain.handle("diy:composerClose", (e) => {
    fromComposer(e);
    composer.close();
  });
  return {
    dispose() {
      clearInterval(timer);
      diy.dispose();
      composer?.close();
    },
  };
}
module.exports = { createDiyManager };
