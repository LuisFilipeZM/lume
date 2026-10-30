// Detalhes do WebRTC usados tanto por quem envia quanto por quem recebe.

// Candidatos ICE que chegam antes da descrição remota ficam numa fila
export async function setRemote(pc, sdp) {
  await pc.setRemoteDescription(sdp);
  for (const c of pc._queue || []) { try { await pc.addIceCandidate(c); } catch {} }
  pc._queue = [];
}

export async function addCandidate(pc, cand) {
  if (pc.remoteDescription) { try { await pc.addIceCandidate(cand); } catch {} }
  else (pc._queue = pc._queue || []).push(cand);
}
