'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('touchbar', {
  getDIY: () => ipcRenderer.invoke('diy:get'),
  refreshDIY: () => ipcRenderer.invoke('diy:refresh'),
  startDIY: payload => ipcRenderer.invoke('diy:start', payload),
  cancelDIY: () => ipcRenderer.invoke('diy:cancel'),
  pluginAction: (id, op, arg) => ipcRenderer.invoke('diy:action', id, op, arg),
  importPlugin: () => ipcRenderer.invoke('diy:import'),
  exportPlugin: id => ipcRenderer.invoke('diy:export', id),
  openPluginLink: (id, index) => ipcRenderer.invoke('diy:link', id, index),
  openCommunity: () => ipcRenderer.invoke('diy:community'),
  openDIYComposer: payload => ipcRenderer.invoke('diy:composer', payload),
  onDIY: callback => { const listener = (_e, state) => callback(state); ipcRenderer.on('diy:changed', listener); return () => ipcRenderer.removeListener('diy:changed', listener); },
  getWidgets: () => ipcRenderer.invoke('widgets:get'),
  openWidgets: () => ipcRenderer.invoke('widgets:open'),
  previewWidgets: layout => ipcRenderer.invoke('widgets:preview', layout),
  finishWidgets: save => ipcRenderer.invoke('widgets:finish', save),
  onWidgets: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('widgets:changed', listener);
    return () => ipcRenderer.removeListener('widgets:changed', listener);
  },
  getProductivity: () => ipcRenderer.invoke('productivity:get'),
  productivityAction: (op, payload) => ipcRenderer.invoke('productivity:action', op, payload),
  openTodoEditor: id => ipcRenderer.invoke('productivity:edit', id),
  onProductivity: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('productivity:changed', listener);
    return () => ipcRenderer.removeListener('productivity:changed', listener);
  },
  onProductivityOpen: callback => {
    const listener = (_event, view) => callback(view);
    ipcRenderer.on('productivity:open', listener);
    return () => ipcRenderer.removeListener('productivity:open', listener);
  },
  getMusicState: () => ipcRenderer.invoke('music:state'),
  seekMusic: (token, seconds) => ipcRenderer.invoke('music:seek', token, seconds),
  getMusicLyrics: token => ipcRenderer.invoke('music:lyrics', token),
  importMusicLyrics: token => ipcRenderer.invoke('music:import', token),
  getAIState: () => ipcRenderer.invoke('ai:state'),
  getControls: () => ipcRenderer.invoke('controls:get'),
  runAction: action => ipcRenderer.invoke('controls:action', action),
  setVolume: (value, deviceId) => ipcRenderer.invoke('controls:volume', value, deviceId),
  setBrightness: value => ipcRenderer.invoke('controls:brightness', value),
  setMuted: (value, deviceId) => ipcRenderer.invoke('controls:muted', value, deviceId),
  onControls: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('controls:changed', listener);
    return () => ipcRenderer.removeListener('controls:changed', listener);
  },
  getLayout: () => ipcRenderer.invoke('touchbar:state'),
  onLayout: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, layout) => callback({
      orientation: layout.orientation,
      edge: layout.edge,
      scale: layout.scale,
    });
    ipcRenderer.on('touchbar:layout', listener);
    return () => ipcRenderer.removeListener('touchbar:layout', listener);
  },
});
