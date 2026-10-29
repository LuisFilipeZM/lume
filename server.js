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
const INDEX = path.join(__dirname, 'public', 'index.html');

const rooms = new Map(); // sala -> Map(id -> { id, name, sharing, ws })

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

function startServer(port = 3000, host = '0.0.0.0') {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/' || url === '/index.html') {
        fs.readFile(INDEX, (err, data) => {
          if (err) {
            res.writeHead(500);
            return res.end('Erro ao ler a página.');
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          res.end(data);
        });
      } else {
        res.writeHead(404);
        res.end('Não encontrado');
      }
    });

    const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

    wss.on('connection', (ws) => {
      let me = null;
      let members = null;

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

          members = rooms.get(room);
          if (!members) {
            members = new Map();
            rooms.set(room, members);
          }
          if (members.size >= MAX_PER_ROOM) {
            return send(ws, { type: 'error', message: 'Sala cheia.' });
          }

          me = { id: crypto.randomUUID().slice(0, 8), name, sharing: false, ws, room };
          const peers = [...members.values()].map((p) => ({ id: p.id, name: p.name, sharing: p.sharing }));
          members.set(me.id, me);

          send(ws, { type: 'welcome', id: me.id, iceServers: iceServers(), peers });
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
      resolve({
        port: server.address().port,
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
  startServer(PORT).then((h) => {
    console.log(`Lume rodando em http://localhost:${h.port}`);
  }).catch((err) => {
    console.error('Erro ao iniciar:', err.message);
    process.exit(1);
  });
}
