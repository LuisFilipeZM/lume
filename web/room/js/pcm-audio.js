// Áudio por aplicativo: o PCM que vem do app (processo principal) vira uma faixa de áudio do WebRTC.
let pcmCtx = null;
let pcmNode = null;

export async function createPcmTrack() {
  closePcm();
  pcmCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await pcmCtx.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
  pcmNode = new AudioWorkletNode(pcmCtx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
  const dest = pcmCtx.createMediaStreamDestination();
  pcmNode.connect(dest);
  if (pcmCtx.state === 'suspended') await pcmCtx.resume();
  return dest.stream.getAudioTracks()[0];
}

export function closePcm() {
  if (pcmNode) { try { pcmNode.disconnect(); } catch {} pcmNode = null; }
  if (pcmCtx) { pcmCtx.close().catch(() => {}); pcmCtx = null; }
}

export function pcmActive() {
  return pcmCtx !== null;
}

// Blocos de áudio enviados pelo app enquanto o áudio por aplicativo estiver ligado
export function setupPcm() {
  if (!window.electronAPI || !window.electronAPI.onAppAudio) return;
  window.electronAPI.onAppAudio((chunk) => {
    if (!pcmNode || !chunk) return;
    const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    pcmNode.port.postMessage(ab, [ab]);
  });
}
