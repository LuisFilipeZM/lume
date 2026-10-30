'use strict';
// Caminhos dos arquivos do app (a raiz do projeto fica uma pasta acima de app/)
const path = require('path');

const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  START: path.join(ROOT, 'start.html'),
  PICKER: path.join(ROOT, 'picker.html'),
  PRELOAD: path.join(ROOT, 'preload.js'),
  PICKER_PRELOAD: path.join(ROOT, 'picker-preload.js'),
  // Ícone da janela/barra de tarefas. Para trocar, substitua os arquivos em build/
  ICON: path.join(ROOT, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
};
