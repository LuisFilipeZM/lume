'use strict';
// Áudio por aplicativo (Windows 10 versão 2004 ou mais nova / Windows 11).
// Janela compartilhada: captura só o som do processo dono da janela (e dos processos filhos dele).
// Tela inteira: captura todo o som do PC, menos o do próprio Lume (evita eco de quem você está assistindo).
// Só é iniciado pelo seletor confiável (capture/picker.js), nunca a pedido da página.

let capture = null;       // captura ativa (loopback-capture)
let getWindowPid = null;  // GetWindowThreadProcessId, carregada sob demanda

function windowPid(hwnd) {
  if (!getWindowPid) {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    getWindowPid = user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)');
  }
  const out = [null];
  getWindowPid(hwnd, out);
  return Number(out[0]) || 0;
}

function stop() {
  if (!capture) return;
  try { capture.stop(); } catch {}
  capture = null;
}

// target: webContents que recebe os blocos de áudio (canal 'app-audio-data')
function start(sourceId, target) {
  if (process.platform !== 'win32') return { ok: false, error: 'só no Windows' };
  stop();
  let LoopbackCapture;
  try { ({ LoopbackCapture } = require('loopback-capture')); }
  catch (e) { return { ok: false, error: 'módulo de áudio indisponível: ' + e.message }; }

  const send = (chunk) => {
    if (!target.isDestroyed()) target.send('app-audio-data', chunk);
  };
  try {
    const c = new LoopbackCapture();
    const m = /^window:(\d+):/.exec(String(sourceId));
    if (m) {
      const pid = windowPid(Number(m[1]));
      if (!pid) return { ok: false, error: 'não encontrei o programa dessa janela' };
      c.start(pid, true, send);           // só este aplicativo (e seus processos filhos)
      capture = c;
      return { ok: true, mode: 'app' };
    }
    c.start(process.pid, false, send);    // tela inteira: tudo, exceto o próprio Lume
    capture = c;
    return { ok: true, mode: 'system' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { start, stop };
