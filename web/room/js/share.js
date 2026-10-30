// Compartilhar e parar de compartilhar a tela.
import { S, PRESETS } from './state.js';
import { $, toast } from './util.js';
import { sendWs } from './signaling.js';
import { playSound } from './sounds.js';
import { renderPeers } from './peers.js';
import { tileFor, removeTile } from './layout.js';
import { connectToViewer, closeSend, updateOwnLabel } from './rtc-send.js';
import { createPcmTrack, closePcm } from './pcm-audio.js';

const SHARE_OPTIONS = ['#audioChk', '#qualitySel', '#codecSel', '#modeSel'];

export async function startShare() {
  S.preset = PRESETS[$('#qualitySel').value];
  const preset = S.preset;
  let wantAudio = $('#audioChk').checked;
  const api = window.electronAPI;
  // No app, getDisplayMedia abre o seletor confiável do Lume: lá a pessoa escolhe a tela ou janela
  // e confirma o áudio. A página só fica sabendo do resultado depois (getShareInfo).
  try {
    S.shareStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: preset.w }, height: { ideal: preset.h }, frameRate: { ideal: preset.fps } },
      audio: wantAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
    });
  } catch (e) {
    if (api && api.stopAppAudio) api.stopAppAudio().catch(() => {});
    return; // cancelado no seletor
  }
  const info = api && api.getShareInfo ? await api.getShareInfo().catch(() => null) : null;
  const isWindow = !!info && info.kind === 'window';
  if (info) wantAudio = !!info.audioChosen; // a escolha final do áudio é feita no seletor
  // 'app' = só o aplicativo da janela; 'system' = PC inteiro sem o Lume (chegam pelo app, em PCM)
  let appAudioMode = info && (info.audio === 'app' || info.audio === 'system') ? info.audio : null;
  if (appAudioMode) {
    try {
      S.shareStream.addTrack(await createPcmTrack());
    } catch (e) {
      console.warn('falha ao montar o áudio', e);
      api.stopAppAudio();
      appAudioMode = null;
    }
  }
  const vt = S.shareStream.getVideoTracks()[0];
  vt.contentHint = $('#modeSel').value;
  vt.onended = stopShare;
  // Limita a captura à qualidade escolhida (evita capturar uma tela 4K/144 Hz para depois reduzir)
  try {
    await vt.applyConstraints({ width: { max: preset.w }, height: { max: preset.h }, frameRate: { max: preset.fps } });
  } catch {}

  if (wantAudio && S.shareStream.getAudioTracks().length === 0) {
    toast(!api
      ? 'O áudio não foi capturado. No Chrome, marque “Compartilhar áudio do sistema/da guia” na janela de seleção.'
      : isWindow
        ? 'Não consegui capturar só o áudio deste aplicativo (precisa do Windows 10 versão 2004 ou mais novo). A janela será compartilhada sem áudio.'
        : 'O áudio do PC não foi capturado (só há suporte no Windows).');
  } else if (appAudioMode === 'app') {
    toast('Áudio: só o som deste aplicativo.');
  } else if (appAudioMode === 'system') {
    toast('Áudio: todo o som do PC, menos o do Lume. Para enviar só um aplicativo, compartilhe a janela dele.');
  } else if (info && info.audio === 'loopback') {
    toast('Áudio: todo o som do PC, incluindo o do Lume. Use fones para evitar eco.');
  }

  S.sharing = true;
  $('#shareBtn').textContent = '⏹ Parar compartilhamento';
  $('#shareBtn').classList.add('danger');
  for (const id of SHARE_OPTIONS) $(id).disabled = true;

  // Prévia própria leve: uma cópia em baixa resolução e 5 fps (o que os amigos recebem não muda)
  S.previewTrack = vt.clone();
  S.previewTrack.applyConstraints({ width: { max: 640 }, height: { max: 360 }, frameRate: { max: 5 } }).catch(() => {});
  S.previewTrack.enabled = S.windowVisible;
  const t = tileFor(S.myId, 'Você está compartilhando', true);
  t.querySelector('video').srcObject = new MediaStream([S.previewTrack]);

  sendWs({ type: 'sharing', on: true });
  playSound('shareOn');
  renderPeers();
  updateOwnLabel();
  for (const id of S.peers.keys()) connectToViewer(id).catch(console.error);
}

export function stopShare() {
  if (!S.sharing) return;
  S.sharing = false;
  for (const id of [...S.sendPcs.keys()]) closeSend(id);
  if (S.shareStream) S.shareStream.getTracks().forEach((t) => t.stop());
  if (S.previewTrack) S.previewTrack.stop();
  S.shareStream = null;
  S.previewTrack = null;
  closePcm();
  if (window.electronAPI && window.electronAPI.stopAppAudio) window.electronAPI.stopAppAudio().catch(() => {});
  removeTile(S.myId);
  sendWs({ type: 'sharing', on: false });
  playSound('shareOff');
  $('#shareBtn').textContent = '🖥️ Compartilhar tela';
  $('#shareBtn').classList.remove('danger');
  for (const id of SHARE_OPTIONS) $(id).disabled = false;
  renderPeers();
}

export function setupShareButton() {
  $('#shareBtn').onclick = () => (S.sharing ? stopShare() : startShare());
}
