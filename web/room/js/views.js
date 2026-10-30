// Lado de quem assiste: informa a quem compartilha o tamanho em que vê cada tela, se a janela está
// visível e se clicou em "Assistir". Com isso, quem compartilha envia só o necessário.
import { S } from './state.js';
import { sendSignal } from './signaling.js';

let viewTimer = null;

// now = true: avisa já; senão espera 300 ms para agrupar várias mudanças
export function reportViews(now) {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    const dpr = window.devicePixelRatio || 1;
    for (const id of S.recvPcs.keys()) {
      const t = document.getElementById('tile-' + id);
      if (!t) continue;
      const v = t.querySelector('video');
      const w = Math.round(v.clientWidth * dpr), h = Math.round(v.clientHeight * dpr);
      if (!w || !h) continue;
      const isWatching = S.watching.has(id);
      const prev = S.lastView.get(id);
      if (prev && prev.visible === S.windowVisible && prev.watching === isWatching &&
          Math.abs(prev.w - w) < prev.w * 0.1 && Math.abs(prev.h - h) < prev.h * 0.1) continue;
      S.lastView.set(id, { w, h, visible: S.windowVisible, watching: isWatching });
      sendSignal(id, { kind: 'view', w, h, visible: S.windowVisible, watching: isWatching });
    }
  }, now ? 0 : 300);
}

// Janela escondida (bandeja/minimizada): pausa o vídeo recebido e a própria prévia
export function setWindowVisible(visible) {
  if (S.windowVisible === visible) return;
  S.windowVisible = visible;
  if (S.previewTrack) S.previewTrack.enabled = visible;
  reportViews(true);
}

export function setupVisibility() {
  if (window.electronAPI && window.electronAPI.onWindowVisibility) {
    window.electronAPI.onWindowVisibility(setWindowVisible);
  } else {
    document.addEventListener('visibilitychange', () => setWindowVisible(document.visibilityState === 'visible'));
  }
  document.addEventListener('fullscreenchange', () => reportViews(true));
}
