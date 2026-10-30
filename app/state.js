'use strict';
// Estado compartilhado entre as partes do processo principal.
module.exports = {
  win: null,            // janela principal
  tray: null,           // ícone da bandeja
  isQuitting: false,    // true quando o app está fechando de verdade (Sair, desligar o PC, atualização)
  localUrl: null,       // endereço do servidor desta máquina, quando você cria a sala
  allowedOrigin: null,  // única origem (a sala aberta na janela) autorizada a usar os canais da sala
};
