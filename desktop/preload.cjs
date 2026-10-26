'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('touchbar', {
  getControls: () => ipcRenderer.invoke('controls:get'),
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
