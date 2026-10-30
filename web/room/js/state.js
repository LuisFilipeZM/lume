// Estado da sala, compartilhado pelos módulos (no lugar das antigas variáveis globais).

export const PRESETS = {
  '720p30':  { w: 1280, h: 720,  fps: 30, br: 2500000 },
  '1080p30': { w: 1920, h: 1080, fps: 30, br: 5000000 },
  '1080p60': { w: 1920, h: 1080, fps: 60, br: 8000000 },
};

// Prévia enviada a quem ainda não clicou em "Assistir": pequena, 2 quadros por segundo e sem áudio
export const PREVIEW = { h: 180, fps: 2, br: 150000 };

export const S = {
  // conexão e sala
  ws: null,
  myId: null,
  myName: '',
  room: '',
  roomLocked: false,
  leaving: false,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  peers: new Map(),        // id -> { name, sharing }

  // compartilhando (eu envio)
  sharing: false,
  shareStream: null,
  previewTrack: null,      // cópia leve da própria tela, só para a prévia
  preset: PRESETS['1080p60'],
  sendPcs: new Map(),      // espectador -> conexão em que EU envio minha tela
  viewStates: new Map(),   // espectador -> { w, h, visible, watching }

  // assistindo (eu recebo)
  recvPcs: new Map(),      // quem compartilha -> conexão em que EU recebo
  watching: new Set(),     // ids de quem estou assistindo em qualidade total
  lastView: new Map(),     // último tamanho/visibilidade informado a cada um
  windowVisible: true,
};
