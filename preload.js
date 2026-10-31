'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// API exposta às páginas. Nada aqui permite listar telas ou capturar: a captura só acontece pelo
// getDisplayMedia, que abre o seletor confiável do Lume e depende da escolha da pessoa.
contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  // página da sala
  getShareInfo: () => ipcRenderer.invoke('get-share-info'), // o que foi escolhido no seletor
  getPublicUrl: () => ipcRenderer.invoke('get-public-url'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  onWindowVisibility: (cb) => ipcRenderer.on('window-visibility', (_e, visible) => cb(visible)),
  stopAppAudio: () => ipcRenderer.invoke('app-audio-stop'),
  onAppAudio: (cb) => ipcRenderer.on('app-audio-data', (_e, chunk) => cb(chunk)),
  goHome: () => ipcRenderer.invoke('go-home'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // tela inicial
  hostStart: (opts) => ipcRenderer.invoke('host-start', opts),
  openHost: () => ipcRenderer.invoke('open-host'),
  join: (url) => ipcRenderer.invoke('join', url),
  getVersion: () => ipcRenderer.invoke('get-version'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, msg) => cb(msg)),
});
