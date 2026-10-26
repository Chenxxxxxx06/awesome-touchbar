'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('todoEditor', {
  getDraft: () => ipcRenderer.invoke('todo-editor:draft'),
  save: value => ipcRenderer.invoke('todo-editor:save', value),
  close: () => ipcRenderer.invoke('todo-editor:close'),
});
