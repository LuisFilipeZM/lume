'use strict';
// Servidor da sala nesta máquina e o túnel público (opcional, via cloudflared).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { startServer } = require('../server');
const state = require('./state');
const { ROOT } = require('./paths');

let serverHandle = null;
let tunnelProc = null;
let publicUrl = null;

function findCloudflared() {
  const names = ['cloudflared.exe', 'cloudflared'];
  const dirs = [path.dirname(process.execPath), ROOT, process.cwd()];
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return 'cloudflared'; // procura no PATH
}

function startTunnel(local) {
  return new Promise((resolve) => {
    let finished = false;
    let timer = null;
    const finish = (r) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(r);
    };
    timer = setTimeout(() => finish({ error: 'O túnel demorou demais para responder.' }), 30000);

    let proc;
    try {
      proc = spawn(findCloudflared(), ['tunnel', '--url', local], { windowsHide: true });
    } catch (e) {
      return finish({ error: e.message });
    }
    tunnelProc = proc;

    const onData = (buf) => {
      for (const m of buf.toString().matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi)) {
        if (m[1].toLowerCase() !== 'api') {
          publicUrl = m[0];
          return finish({ url: m[0] });
        }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => finish({
      error: e.code === 'ENOENT'
        ? 'cloudflared não encontrado. Instale com: winget install --id Cloudflare.cloudflared (e reabra o app).'
        : e.message,
    }));
    proc.on('exit', () => {
      if (tunnelProc === proc) { tunnelProc = null; publicUrl = null; }
      finish({ error: 'O cloudflared encerrou antes de criar o link.' });
    });
  });
}

// Inicia o servidor (uma vez) e, se pedido, o túnel. opts: { port, tunnel }
async function start(opts = {}) {
  const port = Number(opts.port) || 3000;
  if (!serverHandle) {
    try {
      serverHandle = await startServer(port);
    } catch (err) {
      return {
        ok: false,
        error: err.code === 'EADDRINUSE'
          ? `A porta ${port} já está em uso. Feche outro Lume/servidor ou use outra porta.`
          : err.message,
      };
    }
  }
  state.localUrl = `http://127.0.0.1:${serverHandle.port}`;
  state.allowedOrigin = new URL(state.localUrl).origin;

  let warning = null;
  if (opts.tunnel && !publicUrl) {
    if (state.win) state.win.webContents.send('status', 'Criando link público…');
    const r = await startTunnel(state.localUrl);
    if (r.error) warning = r.error;
  }
  return { ok: true, publicUrl: opts.tunnel ? publicUrl : null, warning };
}

function getPublicUrl() {
  return publicUrl;
}

function shutdown() {
  try { if (tunnelProc) tunnelProc.kill(); } catch {}
  try { if (serverHandle) serverHandle.close(); } catch {}
}

module.exports = { start, getPublicUrl, shutdown };
