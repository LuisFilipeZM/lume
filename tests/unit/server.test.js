'use strict';
// Servidor de sinalização: salas, senha opcional, bloqueio por tentativas e repasse de mensagens.
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer } = require('../../server');

let srv;
let url;
const open = [];

test.before(async () => {
  srv = await startServer(0, '127.0.0.1');
  url = `ws://127.0.0.1:${srv.port}`;
});
test.after(() => {
  for (const ws of open) ws.terminate();
  srv.close();
});

// Conecta e entra numa sala. ip: simula o IP real que chega pelo túnel da Cloudflare.
function join(room, name, password, ip) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, ip ? { headers: { 'cf-connecting-ip': ip } } : {});
    open.push(ws);
    const msgs = [];
    const started = Date.now();
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', room, name, password })));
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      msgs.push(m);
      if (m.type === 'welcome' || m.type === 'error') resolve({ ws, m, msgs, ms: Date.now() - started });
    });
  });
}

function nextMessage(client, type) {
  return new Promise((resolve) => {
    const found = client.msgs.find((m) => m.type === type && !m.seen);
    if (found) { found.seen = true; return resolve(found); }
    client.ws.on('message', function onMsg(d) {
      const m = JSON.parse(d);
      if (m.type === type) { client.ws.off('message', onMsg); resolve(m); }
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('sala sem senha: entra e recebe a lista de quem já está', async () => {
  const a = await join('aberta', 'Ana', '');
  assert.equal(a.m.type, 'welcome');
  assert.equal(a.m.locked, false);
  assert.ok(Array.isArray(a.m.iceServers) && a.m.iceServers.length > 0);
  const b = await join('aberta', 'Bia', 'qualquer coisa');
  assert.equal(b.m.type, 'welcome', 'sala aberta aceita qualquer coisa no campo de senha');
  assert.deepEqual(b.m.peers.map((p) => p.name), ['Ana']);
  const joined = await nextMessage(a, 'peer-joined');
  assert.equal(joined.name, 'Bia');
});

test('sinalização: repassa mensagens só para o destinatário e avisa quem compartilha e quem sai', async () => {
  const a = await join('sinal', 'Ana', '');
  const b = await join('sinal', 'Bia', '');
  a.ws.send(JSON.stringify({ type: 'signal', to: b.m.id, data: { kind: 'offer', sdp: 'x' } }));
  const sig = await nextMessage(b, 'signal');
  assert.equal(sig.from, a.m.id);
  assert.deepEqual(sig.data, { kind: 'offer', sdp: 'x' });

  a.ws.send(JSON.stringify({ type: 'sharing', on: true }));
  const sh = await nextMessage(b, 'sharing');
  assert.deepEqual([sh.id, sh.on], [a.m.id, true]);

  a.ws.close();
  const left = await nextMessage(b, 'peer-left');
  assert.equal(left.id, a.m.id);
});

test('nome da sala é obrigatório e nomes longos são cortados', async () => {
  const r = await join('   ', 'Ana', '');
  assert.equal(r.m.type, 'error');
  const longo = await join('nomes', 'x'.repeat(100), '');
  const outro = await join('nomes', 'Bia', '');
  assert.equal(outro.m.peers[0].name.length, 24);
  assert.equal(longo.m.type, 'welcome');
});

test('sala com senha: exige a senha certa', async () => {
  const dona = await join('secreta', 'Ana', 'pizza42');
  assert.equal(dona.m.locked, true, 'quem cria define a senha');

  const semSenha = await join('secreta', 'Bia', '');
  assert.equal(semSenha.m.code, 'password-required');

  const errada = await join('secreta', 'Bia', 'pizza41');
  assert.equal(errada.m.code, 'wrong-password');
  assert.ok(errada.ms >= 350, `senha errada responde com atraso (${errada.ms} ms)`);

  const certa = await join('secreta', 'Bia', 'pizza42');
  assert.equal(certa.m.type, 'welcome');
  assert.equal(certa.m.locked, true);
});

test('bloqueia o IP por 1 minuto após 5 senhas erradas, sem afetar outros IPs', async () => {
  await join('cofre', 'Ana', 'segredo');
  for (let i = 0; i < 5; i++) await join('cofre', 'Eve', 'chute' + i, '9.9.9.9');
  const bloqueado = await join('cofre', 'Eve', 'segredo', '9.9.9.9');
  assert.equal(bloqueado.m.code, 'blocked', 'nem a senha certa entra durante o bloqueio');
  const outroIp = await join('cofre', 'Fabi', 'segredo', '8.8.8.8');
  assert.equal(outroIp.m.type, 'welcome');
});

test('a senha some quando a sala esvazia', async () => {
  const a = await join('temporaria', 'Ana', 'abc');
  a.ws.close();
  await wait(200);
  const b = await join('temporaria', 'Bia', '');
  assert.equal(b.m.type, 'welcome');
  assert.equal(b.m.locked, false);
});

test('sala cheia recusa a 13ª pessoa', async () => {
  for (let i = 0; i < 12; i++) assert.equal((await join('lotada', 'P' + i, '')).m.type, 'welcome');
  const r = await join('lotada', 'Extra', '');
  assert.equal(r.m.type, 'error');
  assert.match(r.m.message, /cheia/);
});

test('serve a página da sala e os arquivos dela, com o tipo certo', async () => {
  const base = `http://127.0.0.1:${srv.port}`;
  const page = await fetch(base + '/?room=x');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /<title>Lume<\/title>/);
  const css = await fetch(base + '/room.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const js = await fetch(base + '/js/main.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/, 'módulos precisam do tipo JavaScript');
  assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
});

// Pedido HTTP "cru", sem o fetch normalizar o caminho
function rawGet(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = require('http').request({ host: '127.0.0.1', port: srv.port, path: pathname, method }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('não serve nada fora da pasta da página', async () => {
  for (const p of ['/../server.js', '/..%2fserver.js', '/%2e%2e/server.js', '/..%5c..%5cserver.js',
    '/js/../../server.js', '/../package.json', '/x%00.js', '/js/main.js.bak', '/nao-existe.js']) {
    assert.equal(await rawGet(p), 404, p);
  }
  assert.equal(await rawGet('/%E0%A4%A', 'GET'), 400, 'endereço mal formado');
  assert.equal(await rawGet('/', 'POST'), 405, 'só GET/HEAD');
  assert.equal(await rawGet('/', 'HEAD'), 200);
});

test('por padrão escuta só nesta máquina (127.0.0.1)', async () => {
  const h = await startServer(0);
  try {
    assert.equal(h.host, '127.0.0.1');
  } finally {
    h.close();
  }
});
