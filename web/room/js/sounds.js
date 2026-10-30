// Sons de entrada, saída e compartilhamento (gerados na hora, sem arquivos).
import { $, store, load } from './util.js';

let actx = null;

export function initSound() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {}
}

// [frequência em Hz, atraso em segundos]
const SOUNDS = {
  join:     [[523.25, 0], [783.99, 0.09]],                    // sobe: alguém entrou
  leave:    [[783.99, 0], [523.25, 0.09]],                    // desce: alguém saiu
  shareOn:  [[587.33, 0], [880.00, 0.07], [1174.66, 0.14]],   // sobe rápido: começou a compartilhar
  shareOff: [[1174.66, 0], [880.00, 0.07], [587.33, 0.14]],   // desce rápido: parou
};

export function playSound(name) {
  if (!$('#soundChk').checked) return;
  initSound();
  if (!actx) return;
  const t0 = actx.currentTime + 0.01;
  for (const [freq, dt] of SOUNDS[name]) {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + dt + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.22);
    o.connect(g).connect(actx.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.25);
  }
}

export function setupSounds() {
  $('#soundChk').checked = load('ts-sounds') !== '0';
  $('#soundChk').onchange = () => store('ts-sounds', $('#soundChk').checked ? '1' : '0');
}
