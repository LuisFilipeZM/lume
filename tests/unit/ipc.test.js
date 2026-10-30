'use strict';
// A tabela de canais (app/ipc.js) e o que as páginas usam (preload.js) precisam bater:
// todo canal chamado tem que estar na tabela, com quem pode chamá-lo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('todo canal usado pelo preload está na tabela de permissões, e nada sobra', () => {
  const usados = [...read('preload.js').matchAll(/invoke\('([a-z-]+)'/g)].map((m) => m[1]).sort();
  const tabela = [...read('app/ipc.js').matchAll(/^ {2}'([a-z-]+)': \['(start|room)'/gm)].map((m) => m[1]).sort();
  assert.ok(usados.length > 0);
  assert.deepEqual(usados, tabela);
});

test('nenhum canal da sala permite listar telas, capturar ou ligar o áudio', () => {
  const sala = [...read('app/ipc.js').matchAll(/^ {2}'([a-z-]+)': \['room'/gm)].map((m) => m[1]);
  for (const proibido of ['get-sources', 'select-source', 'app-audio-start']) assert.ok(!sala.includes(proibido), proibido);
  assert.doesNotMatch(read('preload.js'), /getSources|selectSource|startAppAudio/);
});

test('canais registrados direto no ipcMain só existem no seletor (com checagem do remetente)', () => {
  for (const f of ['app/index.js', 'app/window.js', 'app/room-host.js', 'app/updates.js', 'app/capture/app-audio.js']) {
    assert.doesNotMatch(read(f), /ipcMain\.(handle|on)\(/, `${f} não deve registrar canais fora de ipc.js`);
  }
  const picker = read('app/capture/picker.js');
  assert.match(picker, /if \(e\.sender !== pw\.webContents\) return;/);
});
