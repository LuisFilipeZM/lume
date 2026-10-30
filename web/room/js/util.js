// Utilidades da página.

export const $ = (s) => document.querySelector(s);

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 5000);
}

export function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
export function load(k) { try { return localStorage.getItem(k); } catch { return null; } }

export function randomRoom() {
  const c = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

// Pede ao Opus áudio estéreo de boa qualidade (o padrão do navegador é mais fraco)
export function fixOpus(sdp) {
  return sdp.replace(/(a=fmtp:\d+ [^\r\n]*useinbandfec=1)/g, '$1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000');
}
