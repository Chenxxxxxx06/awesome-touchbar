const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("diyComposer", {
  get: () => ipcRenderer.invoke("diy:composerGet"),
  start: (payload) => ipcRenderer.invoke("diy:composerStart", payload),
  close: () => ipcRenderer.invoke("diy:composerClose"),
});
