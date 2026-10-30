'use strict';
// Todos os canais que as páginas podem chamar no processo principal, e quem pode chamar cada um.
//
//   'start'  tela inicial do Lume (arquivo local start.html)
//   'room'   a página da sala aberta na janela (a origem autorizada em state.allowedOrigin;
//            pode ser a sala de outra pessoa, então nada aqui permite capturar ou ler o sistema)
//
// Qualquer chamada de quem não está autorizado é recusada com "não autorizado".
// Os canais da janela do seletor de tela (picker-result, picker-refresh) ficam em capture/picker.js
// e só aceitam mensagens da própria janela do seletor.
const { app, ipcMain, clipboard } = require('electron');
const state = require('./state');
const roomHost = require('./room-host');
const picker = require('./capture/picker');
const appAudio = require('./capture/app-audio');
const { goStart, openRoom } = require('./window');

/** @type {Record<string, ['start' | 'room', (...args: any[]) => any]>} */
const CHANNELS = {
  // ---- tela inicial ----
  'host-start': ['start', (opts) => roomHost.start(opts || {})],
  'open-host': ['start', async () => {
    if (!state.localUrl) return;
    await openRoom(state.localUrl);
  }],
  'join': ['start', async (raw) => {
    const text = String(raw || '').trim();
    let u = null;
    for (const candidate of [text, 'https://' + text]) {
      try { u = new URL(candidate); break; } catch {}
    }
    if (!u || !/^https?:$/.test(u.protocol)) return { ok: false, error: 'Link inválido.' };
    try {
      await openRoom(u.toString());
    } catch (err) {
      await goStart({ error: 'Não foi possível abrir o link: ' + err.message });
    }
    return { ok: true };
  }],
  'get-version': ['start', () => app.getVersion()],

  // ---- sala ----
  'go-home': ['room', () => goStart()],
  'copy-text': ['room', (text) => { clipboard.writeText(String(text).slice(0, 2000)); return true; }],
  'get-public-url': ['room', () => roomHost.getPublicUrl()],
  'get-share-info': ['room', () => picker.consumeShareInfo()], // o que foi escolhido no seletor
  'app-audio-stop': ['room', () => appAudio.stop()],           // ligar o áudio só pelo seletor
};

function senderUrl(e) {
  try { return e.senderFrame.url || ''; } catch { return ''; }
}

function isAllowed(who, e) {
  const url = senderUrl(e);
  if (who === 'start') return url.startsWith('file://');
  if (who === 'room') {
    let origin = '';
    try { origin = new URL(url).origin; } catch {}
    return !!state.allowedOrigin && origin === state.allowedOrigin;
  }
  return false;
}

function register() {
  for (const [name, [who, handler]] of Object.entries(CHANNELS)) {
    ipcMain.handle(name, (e, ...args) => {
      if (!isAllowed(who, e)) throw new Error('não autorizado');
      return handler(...args);
    });
  }
}

module.exports = { register, CHANNELS };
