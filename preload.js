'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// API exposta às páginas. O processo principal só aceita os comandos sensíveis
// (listar telas, escolher tela) da página da sala à qual o usuário entrou.
contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  // página da sala
  getSources: () => ipcRenderer.invoke('get-sources'),
  selectSource: (id) => ipcRenderer.invoke('select-source', id),
  getPublicUrl: () => ipcRenderer.invoke('get-public-url'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  onWindowVisibility: (cb) => ipcRenderer.on('window-visibility', (_e, visible) => cb(visible)),
  // áudio só do aplicativo compartilhado (ou do PC sem o Lume, na tela inteira)
  startAppAudio: (sourceId) => ipcRenderer.invoke('app-audio-start', sourceId),
  stopAppAudio: () => ipcRenderer.invoke('app-audio-stop'),
  onAppAudio: (cb) => ipcRenderer.on('app-audio-data', (_e, chunk) => cb(chunk)),
  goHome: () => ipcRenderer.invoke('go-home'),
  // tela inicial
  hostStart: (opts) => ipcRenderer.invoke('host-start', opts),
  openHost: () => ipcRenderer.invoke('open-host'),
  join: (url) => ipcRenderer.invoke('join', url),
  getVersion: () => ipcRenderer.invoke('get-version'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, msg) => cb(msg)),
});
