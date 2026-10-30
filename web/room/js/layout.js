// Telas na grade: criar, remover e organizar para ficarem o maior possível.
import { $ } from './util.js';
import { reportViews } from './views.js';

export function updateEmpty() {
  $('#empty').classList.toggle('hidden', $('#grid').children.length > 0);
  layoutTiles();
}

// Escolhe o número de colunas que deixa cada tela (16:9) o maior possível no espaço disponível
export function layoutTiles() {
  const stage = $('#stage'), grid = $('#grid');
  const tiles = [...grid.children];
  const n = tiles.length;
  if (!n) return;
  const cs = getComputedStyle(stage);
  const W = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (W <= 0 || H <= 0) return;
  const gap = 12, ratio = 16 / 9;
  let best = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    let w = (W - gap * (cols - 1)) / cols;
    if (w / ratio * rows + gap * (rows - 1) > H) w = ((H - gap * (rows - 1)) / rows) * ratio;
    if (w > best) best = w;
  }
  best = Math.max(80, Math.floor(best));
  grid.style.height = H + 'px';
  for (const t of tiles) t.style.width = best + 'px';
  reportViews(); // o tamanho das telas mudou: avisa quem compartilha
}

export function setupLayout() {
  new ResizeObserver(layoutTiles).observe($('#stage'));
}

// Cria (ou devolve) a tela de alguém. local = a minha própria prévia.
// Telas de amigos começam como prévia; onWatch/onStopWatch: botão Assistir e o ✕.
/**
 * @param {string} id
 * @param {string} label
 * @param {boolean} local
 * @param {{ onWatch?: (id: string) => void, onStopWatch?: (id: string) => void }} [handlers]
 */
export function tileFor(id, label, local, { onWatch, onStopWatch } = {}) {
  let t = document.getElementById('tile-' + id);
  if (t) return t;
  t = document.createElement('div');
  t.className = 'tile';
  t.id = 'tile-' + id;
  t.innerHTML = '<video autoplay playsinline></video><div class="label"></div>' +
    '<div class="tools"><input type="range" min="0" max="1" step="0.05" value="1" title="Volume">' +
    '<button class="fsBtn" title="Tela cheia">⛶</button><button class="stopBtn" title="Parar de assistir (volta para a prévia)">✕</button></div>';
  t.querySelector('.label').textContent = label;
  const v = t.querySelector('video');
  const vol = t.querySelector('input');
  if (local) {
    v.muted = true;
    vol.classList.add('hidden');
    t.querySelector('.stopBtn').classList.add('hidden');
  } else {
    // Tela de um amigo: começa como prévia, com o botão Assistir
    t.classList.add('preview');
    v.muted = true;
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = '<span class="tag">Prévia</span><button>▶ Assistir</button>';
    ov.querySelector('button').onclick = () => onWatch && onWatch(id);
    t.append(ov);
    /** @type {HTMLElement} */ (t.querySelector('.stopBtn')).onclick = () => onStopWatch && onStopWatch(id);
  }
  vol.oninput = () => { v.muted = false; v.volume = Number(vol.value); };
  const fs = () => {
    if (t.classList.contains('preview')) return;
    if (v.requestFullscreen) v.requestFullscreen();
  };
  /** @type {HTMLElement} */ (t.querySelector('.fsBtn')).onclick = fs;
  v.ondblclick = fs;
  v.onclick = () => { if (!local && !t.classList.contains('preview')) v.muted = false; };
  $('#grid').append(t);
  updateEmpty();
  return t;
}

export function removeTile(id) {
  const t = document.getElementById('tile-' + id);
  if (t) t.remove();
  updateEmpty();
}
