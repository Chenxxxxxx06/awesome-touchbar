"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("widgetsEditor", {
  get: () => ipcRenderer.invoke("widgets:get"),
  preview: (layout) => ipcRenderer.invoke("widgets:preview", layout),
  preset: (id) => ipcRenderer.invoke("widgets:preset", id),
  savePreset: (name) => ipcRenderer.invoke("widgets:savePreset", name),
  deletePreset: (id) => ipcRenderer.invoke("widgets:deletePreset", id),
  finish: (save) => ipcRenderer.invoke("widgets:finish", save),
  onChange: (callback) => {
    const listener = (_e, state) => callback(state);
    ipcRenderer.on("widgets:changed", listener);
    return () => ipcRenderer.removeListener("widgets:changed", listener);
  },
});
