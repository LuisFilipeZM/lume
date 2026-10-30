'use strict';
// Servidor de sinalização: serve a página e repassa mensagens WebRTC entre os participantes de uma sala.
// O vídeo/áudio NÃO passa por aqui: vai direto entre os aplicativos (P2P).
//
// Uso standalone:  node server.js      (ou: npm run server)
// Uso embutido:    const { startServer } = require('./server');

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const MAX_PER_ROOM = 12;
const WEB = path.join(__dirname, 'web', 'room'); // arquivos da página da sala

// ---------- arquivos da página ----------
// Serve só o que está dentro de web/room, só GET/HEAD e só tipos conhecidos.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const fail = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); };
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Método não permitido');
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://lume').pathname); } catch { return fail(400, 'Endereço inválido'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(WEB, rel));
  // nada fora da pasta (inclui "..", barras invertidas no Windows e caracteres estranhos)
  if (!file.startsWith(WEB + path.sep) || rel.includes('\0')) return fail(404, 'Não encontrado');
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return fail(404, 'Não encontrado');
  fs.readFile(file, (err, data) => {
    if (err) return fail(404, 'Não encontrado');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const rooms = new Map(); // sala -> { members: Map(id -> { id, name, sharing, ws }), pass: { salt, hash } | null }

// ---------- senha da sala (opcional) ----------
// Quem cria a sala define a senha; ela fica só na memória, como hash (scrypt), e vale enquanto
// a sala existir (some quando a última pessoa sai). Senha em branco = sala aberta.
const MAX_FAILS = 5;            // tentativas erradas antes de bloquear
const BLOCK_MS = 60 * 1000;     // bloqueio de 1 minuto
const fails = new Map();        // ip -> { count, until }

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return { salt, hash: crypto.scryptSync(pw, salt, 32) };
}
function checkPassword(pw, pass) {
  const h = crypto.scryptSync(pw, pass.salt, 32);
  return crypto.timingSafeEqual(h, pass.hash);
}
// IP de quem conecta. Pelo túnel da Cloudflare a conexão chega de 127.0.0.1,
// então nesse caso vale o cabeçalho que a Cloudflare acrescenta com o IP real.
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const cf = req.headers['cf-connecting-ip'];
  return local && cf ? String(cf) : remote;
}
function isBlocked(ip) {
  const f = fails.get(ip);
  return !!(f && f.until > Date.now());
}
function registerFail(ip) {
  const f = fails.get(ip) || { count: 0, until: 0, last: 0 };
  f.count++;
  f.last = Date.now();
  if (f.count >= MAX_FAILS) { f.until = Date.now() + BLOCK_MS; f.count = 0; }
  fails.set(ip, f);
}

// STUN público do Google. Para amigos atrás de redes difíceis (CGNAT/simétrico),
// defina TURN_URL, TURN_USER e TURN_PASS com um servidor TURN (ex.: coturn).
function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    list.push({
      urls: process.env.TURN_URL.split(','),
      username: process.env.TURN_USER,
      credential: process.env.TURN_PASS,
    });
  }
  return list;
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(members, obj, exceptId) {
  for (const p of members.values()) {
    if (p.id !== exceptId) send(p.ws, obj);
  }
}

// Por padrão escuta só nesta máquina (127.0.0.1): quem está de fora chega pelo túnel
// da Cloudflare, que conecta localmente. Para aceitar a rede local, passe host = '0.0.0.0'.
function startServer(port = 3000, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serveStatic);

    const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

    wss.on('connection', (ws, req) => {
      let me = null;
      let members = null;
      const ip = clientIp(req);

      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch { return; }
        if (!m || typeof m !== 'object') return;

        if (m.type === 'join') {
          if (me) return;
          const room = String(m.room || '').trim().slice(0, 40);
          const name = String(m.name || '').trim().slice(0, 24) || 'Convidado';
          if (!room) return send(ws, { type: 'error', message: 'Informe o nome da sala.' });
          const pw = typeof m.password === 'string' ? m.password.slice(0, 64) : '';

          let r = rooms.get(room);
          if (!r) {
            // sala nova: quem cria define a senha (em branco = sala aberta)
            r = { members: new Map(), pass: pw ? hashPassword(pw) : null };
            rooms.set(room, r);
          } else if (r.pass) {
            if (isBlocked(ip)) {
              return send(ws, { type: 'error', code: 'blocked', message: 'Muitas tentativas com senha errada. Aguarde 1 minuto e tente de novo.' });
            }
            if (!pw) {
              return send(ws, { type: 'error', code: 'password-required', message: 'Esta sala tem senha. Digite a senha para entrar.' });
            }
            if (!checkPassword(pw, r.pass)) {
              registerFail(ip);
              // pequena espera: deixa tentativas em série mais lentas
              return setTimeout(() => send(ws, { type: 'error', code: 'wrong-password', message: 'Senha incorreta.' }), 400);
            }
            fails.delete(ip);
          }
          members = r.members;
          if (members.size >= MAX_PER_ROOM) {
            return send(ws, { type: 'error', message: 'Sala cheia.' });
          }

          me = { id: crypto.randomUUID().slice(0, 8), name, sharing: false, ws, room };
          const peers = [...members.values()].map((p) => ({ id: p.id, name: p.name, sharing: p.sharing }));
          members.set(me.id, me);

          send(ws, { type: 'welcome', id: me.id, iceServers: iceServers(), peers, locked: !!r.pass });
          broadcast(members, { type: 'peer-joined', id: me.id, name: me.name }, me.id);
          return;
        }

        if (!me) return;

        if (m.type === 'signal') {
          const target = members.get(m.to);
          if (target) send(target.ws, { type: 'signal', from: me.id, data: m.data });
        } else if (m.type === 'sharing') {
          me.sharing = !!m.on;
          broadcast(members, { type: 'sharing', id: me.id, on: me.sharing }, me.id);
        }
      });

      ws.on('close', () => {
        if (!me) return;
        members.delete(me.id);
        broadcast(members, { type: 'peer-left', id: me.id });
        if (members.size === 0) rooms.delete(me.room);
      });

      ws.on('error', () => {});
    });

    // Derruba conexões mortas
    const heartbeat = setInterval(() => {
      const now = Date.now();
      // esquece erros antigos (sem tentativa errada há mais de 1 minuto e sem bloqueio ativo)
      for (const [ip, f] of fails) if (f.until < now && now - f.last > BLOCK_MS) fails.delete(ip);
      for (const ws of wss.clients) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
      }
    }, 30000);

    server.once('error', (err) => {
      clearInterval(heartbeat);
      reject(err);
    });

    server.listen(port, host, () => {
      const addr = /** @type {import('net').AddressInfo} */ (server.address());
      resolve({
        port: addr.port,
        host: addr.address,
        close() {
          clearInterval(heartbeat);
          for (const ws of wss.clients) ws.terminate();
          wss.close();
          server.close();
        },
      });
    });
  });
}

module.exports = { startServer };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '127.0.0.1';
  startServer(PORT, HOST).then((h) => {
    console.log(`Lume rodando em http://127.0.0.1:${h.port}` + (h.host === '127.0.0.1' ? '' : ` (escutando em ${h.host})`));
  }).catch((err) => {
    console.error('Erro ao iniciar:', err.message);
    process.exit(1);
  });
}
