'use strict';
// Janela principal, bandeja e navegação entre a tela inicial e a sala.
const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const state = require('./state');
const { START, PRELOAD, ICON } = require('./paths');
const appAudio = require('./capture/app-audio');

let trayHintShown = false; // avisa só na primeira vez que a janela vai para a bandeja

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 720,
    minHeight: 500,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    title: 'Lume',
    icon: ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,     // memória: sem corretor ortográfico (e sem baixar dicionários)
      enableWebSQL: false,
    },
  });
  state.win = win;

  // saiu da sala ou a página recarregou: encerra a captura de áudio
  win.webContents.on('did-start-navigation', (details) => { if (details.isMainFrame) appAudio.stop(); });
  win.webContents.on('render-process-gone', appAudio.stop);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // a janela só navega para a tela inicial ou para a sala autorizada
  win.webContents.on('will-navigate', (ev, url) => {
    if (url.startsWith('file://')) return;
    let o = '';
    try { o = new URL(url).origin; } catch {}
    if (o !== state.allowedOrigin) ev.preventDefault();
  });

  win.loadFile(START);

  // Fechar a janela = esconder na bandeja (o compartilhamento e a sala continuam)
  win.on('close', (ev) => {
    if (state.isQuitting) return;
    ev.preventDefault();
    win.hide();
    if (!trayHintShown && state.tray && process.platform === 'win32') {
      trayHintShown = true;
      state.tray.displayBalloon({
        iconType: 'info',
        title: 'Lume',
        content: 'O Lume continua rodando aqui. Para fechar de vez, clique com o botão direito e escolha "Sair".',
      });
    }
  });
  win.on('closed', () => { if (state.win === win) state.win = null; });

  // Avisa a página quando a janela some (bandeja/minimizada) ou volta,
  // para ela pausar o vídeo que não está sendo visto e economizar GPU/rede.
  const notifyVisibility = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('window-visibility', win.isVisible() && !win.isMinimized());
  };
  win.on('hide', notifyVisibility);
  win.on('show', notifyVisibility);
  win.on('minimize', notifyVisibility);
  win.on('restore', notifyVisibility);
  return win;
}

function showWindow() {
  const win = state.win;
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quitApp() {
  state.isQuitting = true;
  app.quit();
}

// onCheckUpdates / onOpenUpdateLog: ações do menu (vêm de updates.js, ligadas em index.js)
function createTray({ onCheckUpdates, onOpenUpdateLog }) {
  const tray = new Tray(ICON);
  state.tray = tray;
  tray.setToolTip('Lume');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Lume v${app.getVersion()}`, enabled: false },
    { label: 'Abrir Lume', click: showWindow },
    { label: 'Procurar atualizações', click: onCheckUpdates },
    { label: 'Ver registro de atualização', click: onOpenUpdateLog },
    { type: 'separator' },
    { label: 'Sair', click: quitApp },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  return tray;
}

// Volta para a tela inicial: nenhuma sala fica autorizada
function goStart(query) {
  state.allowedOrigin = null;
  return state.win.loadFile(START, query ? { query } : undefined);
}

// Abre uma sala: só a origem dela passa a ser autorizada a usar os canais da sala
function openRoom(url) {
  const u = new URL(url);
  state.allowedOrigin = u.origin;
  return state.win.loadURL(u.toString());
}

// Janela "dona" dos avisos nativos (nenhuma, se o Lume estiver só na bandeja)
function dialogParent() {
  const win = state.win;
  return win && !win.isDestroyed() && win.isVisible() ? win : undefined;
}

module.exports = { createWindow, showWindow, quitApp, createTray, goStart, openRoom, dialogParent };
