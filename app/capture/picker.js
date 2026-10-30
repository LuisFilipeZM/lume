'use strict';
// Seletor de tela confiável.
// Toda captura de tela (getDisplayMedia) passa por aqui. A página não escolhe nada: o Lume abre a
// própria janela de seleção, mostra QUEM está pedindo e só libera o que a pessoa escolher.
// A página não tem acesso à lista de telas, às miniaturas nem ao áudio sem essa confirmação.
//
// Canais desta janela (só aceitos quando vêm da própria janela do seletor):
//   picker-result   escolha ou cancelamento
//   picker-refresh  buscar de novo as telas e janelas
const { BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const state = require('../state');
const { PICKER, PICKER_PRELOAD, ICON } = require('../paths');
const appAudio = require('./app-audio');

let pickerWin = null;
let lastShare = null;                 // resultado da última escolha, consultado pela página
const pickerCooldown = new Map();     // origem -> instante até quando novos pedidos são recusados

function captureLog(msg) {
  console.log(`[captura] ${msg}`);
}

function sameFrame(a, b) {
  return !!(a && b && a.processId === b.processId && a.routingId === b.routingId);
}

// Lista de telas e janelas no formato que o seletor mostra
async function listCaptureSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true,
  });
  const forPicker = sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
    icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
  }));
  return { sources, forPicker };
}

// refresh(): busca a lista de novo (jogo aberto depois do seletor, janela que mudou de modo...)
function showCapturePicker(data, refresh) {
  return new Promise((resolve) => {
    const win = state.win;
    const pw = new BrowserWindow({
      parent: win && !win.isDestroyed() ? win : undefined,
      modal: !!(win && !win.isDestroyed() && win.isVisible()),
      width: 900, height: 640, minWidth: 560, minHeight: 420,
      minimizable: false, maximizable: false, show: false,
      backgroundColor: '#1e1f22', autoHideMenuBar: true, icon: ICON,
      title: 'Lume – escolher o que compartilhar',
      webPreferences: {
        preload: PICKER_PRELOAD,
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      },
    });
    pickerWin = pw;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      ipcMain.removeListener('picker-result', onResult);
      ipcMain.removeListener('picker-refresh', onRefresh);
      if (pickerWin === pw) pickerWin = null;
      if (!pw.isDestroyed()) pw.destroy();
      resolve(result);
    };
    const onResult = (e, r) => {
      if (e.sender !== pw.webContents) return; // só a própria janela do seletor responde
      finish(r && typeof r.id === 'string' ? { id: r.id, audio: !!r.audio } : null);
    };
    let refreshing = false;
    const onRefresh = async (e) => {
      if (e.sender !== pw.webContents || refreshing || done) return;
      refreshing = true;
      try {
        const list = await refresh();
        if (!done && !pw.isDestroyed()) pw.webContents.send('picker-sources', list);
      } catch {}
      refreshing = false;
    };
    ipcMain.on('picker-result', onResult);
    ipcMain.on('picker-refresh', onRefresh);
    pw.on('closed', () => finish(null));
    pw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pw.webContents.on('will-navigate', (ev) => ev.preventDefault());
    pw.webContents.once('did-finish-load', () => {
      pw.webContents.send('picker-data', data);
      pw.show();
      pw.focus();
    });
    pw.loadFile(PICKER).catch(() => finish(null));
  });
}

// Handler do session.setDisplayMediaRequestHandler
async function handleDisplayMediaRequest(request, callback) {
  let answered = false;
  const reply = (v) => { if (!answered) { answered = true; callback(v); } };
  // a origem pode vir com barra no final ("http://127.0.0.1:3000/"): normaliza
  let origin = request.securityOrigin || (request.frame && request.frame.origin) || '';
  try { origin = new URL(origin).origin; } catch {}
  const deny = (why) => {
    captureLog(`negado (${why}) — ${origin || 'origem desconhecida'}`);
    try { reply(null); } catch {} // null = recusar
  };
  try {
    const win = state.win;
    const mainFrame = win && !win.isDestroyed() ? win.webContents.mainFrame : null;
    if (!sameFrame(request.frame, mainFrame)) return deny('pedido de fora da janela principal');
    if (!state.allowedOrigin || origin !== state.allowedOrigin) return deny('origem não autorizada');
    if (request.userGesture === false) return deny('sem clique do usuário');
    if (pickerWin) return deny('já existe um seletor aberto');
    if ((pickerCooldown.get(origin) || 0) > Date.now()) return deny('pedido repetido logo após cancelar');

    let { sources, forPicker } = await listCaptureSources();
    const isLocal = !!state.localUrl && origin === new URL(state.localUrl).origin;
    const choice = await showCapturePicker({
      origin,
      host: (() => { try { return new URL(origin).host; } catch { return origin; } })(),
      isLocal,
      audioRequested: !!request.audioRequested,
      audioSupported: process.platform === 'win32',
      sources: forPicker,
    }, async () => {
      ({ sources, forPicker } = await listCaptureSources()); // a escolha é conferida na lista mais recente
      return forPicker;
    });
    if (!choice) {
      pickerCooldown.set(origin, Date.now() + 2000);
      return deny('cancelado pelo usuário');
    }
    const src = sources.find((s) => s.id === choice.id);
    if (!src) return deny('fonte escolhida não existe mais');

    // Áudio: janela = só o som daquele aplicativo; tela inteira = todo o som do PC menos o Lume.
    // Se o áudio por aplicativo falhar na tela inteira, usa o áudio do sistema do Chromium.
    const kind = src.id.startsWith('screen:') ? 'screen' : 'window';
    const audioChosen = !!(request.audioRequested && choice.audio);
    let audio = null;
    let loopback = false;
    if (audioChosen) {
      const r = appAudio.start(src.id, state.win.webContents);
      if (r.ok) audio = r.mode;
      else if (kind === 'screen') { audio = 'loopback'; loopback = true; }
      else captureLog('áudio do aplicativo indisponível: ' + r.error);
    }
    lastShare = { origin, kind, audioChosen, audio, at: Date.now() };
    captureLog(`permitido: ${src.id} (${kind}), áudio: ${audio || 'nenhum'} — ${origin}`);
    // sem áudio do Chromium: a chave 'audio' não pode ir (nem como undefined), senão o Electron recusa
    reply(loopback ? { video: src, audio: 'loopback' } : { video: src });
  } catch (e) {
    deny('erro: ' + e.message);
  }
}

// O que foi escolhido (tipo e áudio), para a página montar a transmissão. Vale uma vez, por 30 s.
function consumeShareInfo() {
  const s = lastShare;
  lastShare = null;
  if (!s || s.origin !== state.allowedOrigin || Date.now() - s.at > 30000) return null;
  return { kind: s.kind, audioChosen: s.audioChosen, audio: s.audio };
}

module.exports = { handleDisplayMediaRequest, consumeShareInfo };
