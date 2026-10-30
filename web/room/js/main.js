// Página da sala: entrada, mensagens do servidor e ligação entre as partes.
//
//   state.js       estado compartilhado e presets
//   signaling.js   conexão com o servidor
//   share.js       compartilhar / parar (usa rtc-send.js e pcm-audio.js)
//   rtc-send.js    envio para cada espectador (prévia, qualidade sob medida, codec)
//   rtc-recv.js    recepção e o botão Assistir
//   views.js       o que o espectador informa (tamanho, visibilidade, assistindo)
//   layout.js      telas na grade      peers.js  lista de pessoas
//   link.js        link da sala        sounds.js sons         util.js  utilidades
import { S } from './state.js';
import { $, toast, store, load, randomRoom } from './util.js';
import { connect } from './signaling.js';
import { initSound, playSound, setupSounds } from './sounds.js';
import { renderPeers, setupPeersPanel } from './peers.js';
import { setupLayout, tileFor, updateEmpty, removeTile } from './layout.js';
import { setupVisibility, setWindowVisible } from './views.js';
import { setRemote, addCandidate } from './rtc-common.js';
import { onOffer, closeRecv } from './rtc-recv.js';
import { connectToViewer, closeSend, onViewReport, updateOwnLabel } from './rtc-send.js';
import { setupShareButton, stopShare } from './share.js';
import { setupPcm, pcmActive } from './pcm-audio.js';
import { refreshLink, setupLinkBar } from './link.js';

// ---------- entrada ----------
function showJoinError(msg) {
  const el = $('#joinErr');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function join() {
  S.myName = $('#name').value.trim() || 'Convidado';
  S.room = $('#room').value.trim();
  if (!S.room) return;
  store('ts-name', S.myName);
  initSound(); // libera o áudio aproveitando o clique
  $('#joinBtn').disabled = true;
  showJoinError('');
  connect({ room: S.room, name: S.myName, password: $('#pass').value }, onMessage,
    () => toast('Conexão com o servidor perdida. Recarregue a página.'));
}

// ---------- mensagens do servidor ----------
async function onMessage(m) {
  switch (m.type) {
    case 'error':
      // entrada recusada (senha, sala cheia...): mostra no formulário e deixa tentar de novo
      S.ws.rejected = true;
      S.ws.close();
      showJoinError(m.message);
      $('#joinBtn').disabled = false;
      if (m.code === 'wrong-password' || m.code === 'password-required') {
        $('#pass').focus();
        $('#pass').select();
      }
      break;
    case 'welcome':
      S.myId = m.id;
      if (m.iceServers) S.iceServers = m.iceServers;
      for (const p of m.peers) S.peers.set(p.id, { name: p.name, sharing: p.sharing });
      $('#join').classList.add('hidden');
      $('#app').classList.remove('hidden');
      $('#roomName').textContent = S.room;
      S.roomLocked = !!m.locked;
      $('#lockBadge').classList.toggle('hidden', !S.roomLocked);
      $('#pass').value = ''; // não deixa a senha sobrando no formulário
      history.replaceState(null, '', '?room=' + encodeURIComponent(S.room));
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        $('#shareBtn').disabled = true;
        $('#note').textContent = 'Para compartilhar, abra o site via HTTPS (ou localhost). Assistir funciona normalmente.';
      }
      renderPeers();
      refreshLink();
      playSound('join');
      break;
    case 'peer-joined':
      S.peers.set(m.id, { name: m.name, sharing: false });
      renderPeers();
      playSound('join');
      if (S.sharing) await connectToViewer(m.id);
      break;
    case 'peer-left':
      S.peers.delete(m.id);
      S.viewStates.delete(m.id);
      S.watching.delete(m.id);
      playSound('leave');
      closeSend(m.id);
      closeRecv(m.id);
      removeTile(m.id);
      renderPeers();
      updateOwnLabel();
      break;
    case 'sharing': {
      const p = S.peers.get(m.id);
      if (p) p.sharing = m.on;
      playSound(m.on ? 'shareOn' : 'shareOff');
      if (!m.on) { closeRecv(m.id); removeTile(m.id); }
      renderPeers();
      break;
    }
    case 'signal':
      await onSignal(m.from, m.data);
      break;
  }
}

// Sinalização WebRTC repassada pelo servidor
async function onSignal(from, d) {
  if (d.kind === 'offer') {
    await onOffer(from, d.sdp);
  } else if (d.kind === 'answer') {
    const pc = S.sendPcs.get(from);
    if (pc) await setRemote(pc, d.sdp);
  } else if (d.kind === 'ice') {
    const pc = d.side === 'sharer' ? S.recvPcs.get(from) : S.sendPcs.get(from);
    if (pc) await addCandidate(pc, d.candidate);
  } else if (d.kind === 'view') {
    await onViewReport(from, d);
  }
}

// ---------- sair ----------
function leave() {
  S.leaving = true;
  stopShare();
  for (const id of [...S.recvPcs.keys()]) closeRecv(id);
  if (S.ws) S.ws.close();
  if (window.electronAPI) window.electronAPI.goHome();
  else location.href = '/';
}

// ---------- inicialização ----------
setupSounds();
$('#name').value = load('ts-name') || '';
$('#room').value = new URLSearchParams(location.search).get('room') || randomRoom();
$('#joinBtn').onclick = join;
$('#room').onkeydown = $('#name').onkeydown = $('#pass').onkeydown = (e) => { if (e.key === 'Enter') join(); };
setupPeersPanel();
setupLayout();
setupShareButton();
setupPcm();
setupVisibility();
setupLinkBar();
$('#leaveBtn').onclick = leave;
window.addEventListener('beforeunload', () => { S.leaving = true; });

// Acesso para os testes automáticos (tests/e2e). Não dá nenhuma capacidade nova: é o mesmo
// estado que o código desta página já manipula.
window.__lume = { S, tileFor, updateEmpty, stopShare, setWindowVisible, pcmActive };
