'use strict';
// Estado compartilhado entre as partes do processo principal.
// O tipo declarado faz a verificação (npm run typecheck) apontar campos digitados errado.

/**
 * @type {{
 *   win: import('electron').BrowserWindow | null,
 *   tray: import('electron').Tray | null,
 *   isQuitting: boolean,
 *   localUrl: string | null,
 *   allowedOrigin: string | null,
 * }}
 */
const state = {
  win: null,            // janela principal
  tray: null,           // ícone da bandeja
  isQuitting: false,    // true quando o app está fechando de verdade (Sair, desligar o PC, atualização)
  localUrl: null,       // endereço do servidor desta máquina, quando você cria a sala
  allowedOrigin: null,  // única origem (a sala aberta na janela) autorizada a usar os canais da sala
};

module.exports = state;
