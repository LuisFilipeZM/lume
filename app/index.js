'use strict';
// Ponto de entrada do processo principal: prepara o app e liga as partes.
//
//   window.js           janela principal, bandeja e navegação (tela inicial <-> sala)
//   ipc.js              todos os canais chamados pelas páginas, com quem pode chamar cada um
//   room-host.js        servidor da sala nesta máquina e túnel público
//   updates.js          avisos e fluxo de atualização (usa ../updater.js)
//   capture/picker.js   seletor de tela confiável (toda captura passa por ele)
//   capture/app-audio   áudio por aplicativo
const { app, session } = require('electron');
const path = require('path');
const updater = require('../updater');

// Testes automáticos: pasta de dados separada, para rodarem mesmo com o Lume aberto
// (cada pasta de dados tem a sua trava de "uma cópia por vez")
if (process.env.LUME_USER_DATA) app.setPath('userData', process.env.LUME_USER_DATA);

// ---------- modo atualizador ----------
// A versão nova, extraída na pasta temporária, é aberta com --lume-apply-update para trocar os
// arquivos da pasta do Lume. Nesse modo não há janela, bandeja nem servidor: copia, reabre e sai.
if (process.argv.includes('--lume-apply-update')) {
  const userDataDir = app.getPath('userData');
  // perfil separado, para não disputar nada com o Lume que ainda está fechando
  app.setPath('userData', path.join(app.getPath('temp'), 'lume-atualizador-perfil'));
  updater.runApplyMode({
    argv: process.argv,
    userDataDir,
    execPath: process.execPath,
    relaunchArgs: process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : [],
  }).then((code) => app.exit(code), () => app.exit(1));
  return; // eslint-disable-line no-unreachable -- encerra o carregamento do restante do app
}

// Desempenho: não reduzir a prioridade do app quando outra janela (ex.: um jogo) está na frente
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Memória: não manter um processo de página "reserva" pré-carregado (o app só tem uma janela)
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess');

// Windows: agrupa na barra de tarefas com o ícone do app (e não o do Electron)
if (process.platform === 'win32') app.setAppUserModelId('com.lume.app');

const state = require('./state');
const window = require('./window');
const ipc = require('./ipc');
const roomHost = require('./room-host');
const updates = require('./updates');
const picker = require('./capture/picker');
const appAudio = require('./capture/app-audio');

// Só uma cópia do app por vez: abrir de novo apenas traz a janela existente para a frente
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => window.showWindow());

app.whenReady().then(() => {
  if (!gotLock) return;
  session.defaultSession.setDisplayMediaRequestHandler(picker.handleDisplayMediaRequest, { useSystemPicker: false });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['fullscreen', 'display-capture', 'clipboard-sanitized-write'].includes(permission));
  });

  ipc.register();
  window.createWindow();
  window.createTray({
    onCheckUpdates: () => updates.checkForUpdates({ manual: true }),
    onOpenUpdateLog: updates.openUpdateLog,
  });
  state.win.webContents.once('did-finish-load', () => { updates.reportUpdateResult().catch(() => {}); });
  updates.scheduleUpdateChecks();
  updates.cleanupAfterUpdate();
  app.on('activate', window.showWindow);
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  state.isQuitting = true; // cobre também desligar o Windows e o "Sair" da bandeja
  appAudio.stop();
  try { if (state.tray) state.tray.destroy(); } catch {}
  roomHost.shutdown();
});
