// Quem assiste: recebe a tela de um amigo, mostra a prévia e o botão "Assistir".
import { S } from './state.js';
import { toast, fixOpus } from './util.js';
import { sendSignal } from './signaling.js';
import { tileFor } from './layout.js';
import { reportViews } from './views.js';
import { initSound } from './sounds.js';
import { setRemote } from './rtc-common.js';

export function playWithSound(v) {
  v.muted = false;
  v.play().catch(() => {
    v.muted = true;
    v.play().catch(() => {});
    toast('Clique no vídeo para ativar o som.');
  });
}

export function startWatching(id) {
  const t = document.getElementById('tile-' + id);
  if (!t) return;
  initSound();
  S.watching.add(id);
  t.classList.remove('preview');
  const v = t.querySelector('video');
  v.volume = Number(t.querySelector('input').value);
  playWithSound(v);
  reportViews(true); // pede a qualidade total (e o áudio) para quem compartilha
}

export function stopWatching(id) {
  S.watching.delete(id);
  const t = document.getElementById('tile-' + id);
  if (!t) return;
  const v = t.querySelector('video');
  if (document.fullscreenElement === v) document.exitFullscreen().catch(() => {});
  t.classList.add('preview');
  v.muted = true;
  reportViews(true); // volta a receber só a prévia
}

function attachStream(id, stream) {
  const name = (S.peers.get(id) || {}).name || 'Alguém';
  const t = tileFor(id, name + ' está compartilhando', false, { onWatch: startWatching, onStopWatch: stopWatching });
  const v = t.querySelector('video');
  if (v.srcObject !== stream) v.srcObject = stream;
  reportViews();
  if (S.watching.has(id)) {
    playWithSound(v);
  } else {
    v.muted = true;            // prévia: sem som
    v.play().catch(() => {});
  }
}

// Oferta de quem compartilha: cria a conexão de recepção e responde
export async function onOffer(from, sdp) {
  closeRecv(from);
  const pc = new RTCPeerConnection({ iceServers: S.iceServers });
  S.recvPcs.set(from, pc);
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(from, { kind: 'ice', side: 'viewer', candidate: e.candidate });
  };
  pc.ontrack = (e) => attachStream(from, e.streams[0]);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') toast('Falha ao conectar com ' + ((S.peers.get(from) || {}).name || 'o amigo') + '. A rede pode exigir um servidor TURN.');
  };
  await setRemote(pc, sdp);
  const answer = await pc.createAnswer();
  answer.sdp = fixOpus(answer.sdp);
  await pc.setLocalDescription(answer);
  sendSignal(from, { kind: 'answer', sdp: pc.localDescription });
}

export function closeRecv(id) {
  const pc = S.recvPcs.get(id);
  if (pc) { pc.close(); S.recvPcs.delete(id); }
  S.lastView.delete(id);
  // conexão encerrada/refeita: volta para a prévia
  if (S.watching.delete(id)) {
    const t = document.getElementById('tile-' + id);
    if (t) { t.classList.add('preview'); t.querySelector('video').muted = true; }
  }
}
