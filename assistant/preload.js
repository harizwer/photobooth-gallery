// What the window may ask the program to do (nothing else of the computer is reachable from the window).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('assistant', {
  printers: () => ipcRenderer.invoke('printers'),
  print: job => ipcRenderer.invoke('print', job),
  autostart: on => ipcRenderer.invoke('autostart', on),
  version: () => ipcRenderer.invoke('version'),
  openExternal: url => ipcRenderer.invoke('open-external', url),
});
