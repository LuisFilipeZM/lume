// Conexão com o servidor da sala (WebSocket): entrar, mandar e receber mensagens.
import { S } from './state.js';

export function sendWs(obj) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj));
}

export function sendSignal(to, data) {
  sendWs({ type: 'signal', to, data });
}

// Conecta e entra na sala. As mensagens são processadas uma por vez, na ordem em que chegam.
// onLost: a conexão caiu sem ser por saída voluntária nem por recusa na entrada.
export function connect({ room, name, password }, onMessage, onLost) {
  const sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  S.ws = sock;
  let chain = Promise.resolve();
  sock.onopen = () => sock.send(JSON.stringify({ type: 'join', room, name, password }));
  sock.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    chain = chain.then(() => onMessage(m)).catch((e) => console.error(e));
  };
  sock.onclose = () => {
    if (!S.leaving && !sock.rejected) onLost();
  };
  return sock;
}
