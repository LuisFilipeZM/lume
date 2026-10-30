'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Ponte da janela do seletor de tela. Só esta janela, aberta pelo próprio Lume, responde ao pedido
// de captura: a página da sala não tem acesso a nada disto.
contextBridge.exposeInMainWorld('picker', {
  onData: (cb) => ipcRenderer.on('picker-data', (_e, data) => cb(data)),
  choose: (id, audio) => ipcRenderer.send('picker-result', { id: String(id), audio: !!audio }),
  cancel: () => ipcRenderer.send('picker-result', null),
});
