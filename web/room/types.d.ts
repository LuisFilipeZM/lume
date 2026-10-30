// Tipos usados só pela verificação (npm run typecheck); o navegador não carrega este arquivo.

// O que o app (preload.js) oferece à página da sala. No navegador comum, window.electronAPI não existe.
interface ElectronAPI {
  isDesktop: true;
  getShareInfo(): Promise<{ kind: 'screen' | 'window'; audioChosen: boolean; audio: 'app' | 'system' | 'loopback' | null } | null>;
  getPublicUrl(): Promise<string | null>;
  copyText(text: string): Promise<boolean>;
  onWindowVisibility(cb: (visible: boolean) => void): void;
  stopAppAudio(): Promise<void>;
  onAppAudio(cb: (chunk: Uint8Array | ArrayBuffer) => void): void;
  goHome(): Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
  webkitAudioContext?: typeof AudioContext;
  __lume?: Record<string, unknown>; // acesso para os testes automáticos
}

interface WebSocket {
  rejected?: boolean; // entrada recusada pelo servidor (senha, sala cheia...)
}
