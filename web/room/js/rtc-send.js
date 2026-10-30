// Quem compartilha: uma conexão por espectador, com a qualidade sob medida para cada um.
// Cada espectador avisa o tamanho em que está vendo a tela e se a janela dele está visível.
// Quem compartilha codifica só o necessário: prévia para quem não clicou em Assistir;
// tela pequena = resolução e bitrate menores; janela escondida = vídeo pausado (o áudio continua).
import { S, PREVIEW } from './state.js';
import { $, fixOpus } from './util.js';
import { sendSignal } from './signaling.js';

export function viewOf(id) {
  return S.viewStates.get(id) || { w: 0, h: 0, visible: true, watching: false };
}

function videoEncodingFor(id) {
  const v = viewOf(id);
  const preset = S.preset;
  const enc = { active: v.visible !== false, maxBitrate: preset.br, maxFramerate: preset.fps, scaleResolutionDownBy: 1 };
  const s = S.shareStream ? S.shareStream.getVideoTracks()[0].getSettings() : {};
  const srcW = s.width || preset.w, srcH = s.height || preset.h;
  if (!v.watching) {
    enc.scaleResolutionDownBy = Math.max(1, srcH / PREVIEW.h);
    enc.maxFramerate = PREVIEW.fps;
    enc.maxBitrate = PREVIEW.br;
    return enc;
  }
  if (v.w > 0 && v.h > 0) {
    let scale = Math.max(srcW / v.w, srcH / v.h);                  // quanto a imagem é reduzida na tela dele
    scale = Math.min(Math.max(scale, 1), Math.max(1, srcH / 360)); // nunca abaixo de 360p (texto legível)
    scale = Math.max(1, Math.floor(scale * 4) / 4);                // degraus de 0,25 (arredonda a favor da qualidade)
    enc.scaleResolutionDownBy = scale;
    enc.maxBitrate = Math.max(300000, Math.round(preset.br / Math.pow(scale, 1.5)));
  }
  return enc;
}

// Aplica a configuração de envio (vídeo e áudio) para um espectador
async function applySenderParams(pc, id) {
  for (const s of pc.getSenders()) {
    if (!s.track) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = s.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      if (s.track.kind === 'video') {
        Object.assign(p.encodings[0], videoEncodingFor(id));
        p.degradationPreference = $('#modeSel').value === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
      } else {
        p.encodings[0].maxBitrate = 128000;
        p.encodings[0].active = viewOf(id).watching; // áudio só para quem está assistindo
      }
      try { await s.setParameters(p); break; }
      catch (e) { await new Promise((r) => setTimeout(r, 200)); } // outra alteração em andamento: tenta de novo
    }
  }
}

// Prefere um codec de vídeo (H.264 costuma usar o encoder da placa de vídeo, aliviando a CPU).
// É só preferência: se o outro lado não suportar, a negociação escolhe outro.
function preferCodec(pc) {
  const mode = $('#codecSel').value;
  if (mode === 'auto') return;
  try {
    const caps = RTCRtpSender.getCapabilities('video');
    if (!caps) return;
    const want = mode === 'h264' ? 'video/h264' : 'video/vp9';
    const isWanted = (c) => (c.mimeType.toLowerCase() === want ? 1 : 0);
    const sorted = [...caps.codecs].sort((a, b) => isWanted(b) - isWanted(a));
    for (const t of pc.getTransceivers()) {
      if (t.sender.track && t.sender.track.kind === 'video') t.setCodecPreferences(sorted);
    }
  } catch (e) { console.warn('preferCodec', e); }
}

export async function connectToViewer(id) {
  if (!S.shareStream) return;
  closeSend(id);
  S.viewStates.delete(id); // conexão nova: começa como prévia até a pessoa clicar em Assistir
  const pc = new RTCPeerConnection({ iceServers: S.iceServers });
  S.sendPcs.set(id, pc);
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(id, { kind: 'ice', side: 'sharer', candidate: e.candidate });
  };
  S.shareStream.getTracks().forEach((t) => pc.addTrack(t, S.shareStream));
  preferCodec(pc);

  const offer = await pc.createOffer();
  offer.sdp = fixOpus(offer.sdp);
  await pc.setLocalDescription(offer);
  await applySenderParams(pc, id);
  sendSignal(id, { kind: 'offer', sdp: pc.localDescription });
}

export function closeSend(id) {
  const pc = S.sendPcs.get(id);
  if (pc) { pc.close(); S.sendPcs.delete(id); }
}

// Um espectador informou tamanho, visibilidade e se está assistindo: ajusta o envio para ele
export async function onViewReport(from, d) {
  S.viewStates.set(from, { w: Number(d.w) || 0, h: Number(d.h) || 0, visible: d.visible !== false, watching: !!d.watching });
  const pc = S.sendPcs.get(from);
  if (pc) await applySenderParams(pc, from);
  updateOwnLabel();
}

// Mostra na própria prévia quantas pessoas estão assistindo
export function updateOwnLabel() {
  const t = S.myId && document.getElementById('tile-' + S.myId);
  if (!t || !S.sharing) return;
  const n = [...S.sendPcs.keys()].filter((id) => viewOf(id).watching).length;
  t.querySelector('.label').textContent = 'Você está compartilhando · ' +
    (n === 0 ? 'ninguém assistindo ainda' : n === 1 ? '1 pessoa assistindo' : n + ' pessoas assistindo');
}
