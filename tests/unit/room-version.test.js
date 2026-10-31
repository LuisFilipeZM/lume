'use strict';
// Checagem de versão antes de entrar na sala de outra pessoa (app/room-version.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { checkRoomVersion, compare } = require('../../app/room-version');

let srv;
let base;
let resposta = null; // o que /versao devolve; null = 404 (versão antiga, sem checagem)

test.before(async () => {
  srv = http.createServer((req, res) => {
    if (req.url === '/versao' && resposta) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(resposta));
    }
    res.writeHead(404); res.end();
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => srv.close());

test('mesma versão: entra', async () => {
  resposta = { app: 'lume', version: '1.13.0' };
  assert.deepEqual(await checkRoomVersion(base, '1.13.0'), { ok: true });
});

test('sala mais nova: pede para atualizar o seu', async () => {
  resposta = { app: 'lume', version: '1.13.1' };
  const r = await checkRoomVersion(base, '1.13.0');
  assert.equal(r.ok, false);
  assert.match(r.error, /v1\.13\.1.*v1\.13\.0.*Atualize o seu/);
});

test('sala mais antiga: pede para quem criou atualizar', async () => {
  resposta = { app: 'lume', version: '1.12.9' };
  const r = await checkRoomVersion(base, '1.13.0');
  assert.equal(r.ok, false);
  assert.match(r.error, /quem criou a sala atualizar/);
});

test('sala sem /versao (anterior à checagem) ou que não é do Lume: recusa', async () => {
  resposta = null;
  assert.match((await checkRoomVersion(base, '1.13.0')).error, /versão antiga/);
  resposta = { app: 'outro', version: '1.13.0' };
  assert.equal((await checkRoomVersion(base, '1.13.0')).ok, false);
});

test('sala fora do ar: erro de conexão', async () => {
  const r = await checkRoomVersion('http://127.0.0.1:1', '1.13.0', 2000);
  assert.equal(r.ok, false);
  assert.match(r.error, /conectar|respondeu/);
});

test('compara versões numericamente', () => {
  assert.equal(compare('1.10.0', '1.9.9'), 1);
  assert.equal(compare('1.2.3', '1.2.3'), 0);
  assert.equal(compare('1.2.3', '1.2.10'), -1);
});
