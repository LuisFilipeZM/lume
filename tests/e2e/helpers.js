'use strict';
// Ferramentas comuns dos testes completos (navegador e app Electron).
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { chromium, _electron: electron } = require('playwright');
const { startServer } = require('../../server');

const ROOT = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PNG de 1x1 usado como miniatura falsa
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Substitui a captura de tela por um vídeo 1920x1080 gerado (e um tom de 440 Hz como áudio)
const FAKE_SCREEN = `
navigator.mediaDevices.getDisplayMedia = async (c) => {
  const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
  const g = cv.getContext('2d'); let n = 0;
  setInterval(() => { g.fillStyle = 'hsl(' + (n * 7 % 360) + ',70%,50%)'; g.fillRect(0, 0, 1920, 1080); g.fillStyle = '#fff'; g.font = '120px sans-serif'; g.fillText('quadro ' + (n++), 200, 500); }, 33);
  const s = cv.captureStream(30);
  if (c && c.audio) {
    const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination();
    o.connect(d); o.start(); s.addTrack(d.stream.getAudioTracks()[0]);
  }
  return s;
};`;

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function startTestServer() {
  const srv = await startServer(0, '127.0.0.1');
  return { ...srv, base: `http://127.0.0.1:${srv.port}` };
}

async function launchBrowser() {
  return chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
}

// Abre uma página nova, entra na sala e devolve a página. opts.share = simula a captura de tela.
async function enterRoom(browser, base, room, name, { password = '', share = false, viewport } = {}) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  if (share) await page.addInitScript(FAKE_SCREEN);
  await page.goto(`${base}/?room=${encodeURIComponent(room)}`);
  await page.fill('#name', name);
  if (password) await page.fill('#pass', password);
  await page.click('#joinBtn');
  return page;
}

// Estatísticas do que um espectador está recebendo (resolução, quadros, áudio)
function receiveStats(page) {
  return page.evaluate(async () => {
    const pc = [...window.__lume.S.recvPcs.values()][0];
    if (!pc) return null;
    const st = await pc.getStats();
    let v = {}, a = {};
    st.forEach((r) => {
      if (r.type === 'inbound-rtp' && r.kind === 'video') v = r;
      if (r.type === 'inbound-rtp' && r.kind === 'audio') a = r;
    });
    return { w: v.frameWidth || 0, h: v.frameHeight || 0, frames: v.framesDecoded || 0, audioPackets: a.packetsReceived || 0 };
  });
}

// Quadros e pacotes de áudio recebidos por segundo, medidos durante "secs" segundos
async function receiveRate(page, secs = 2) {
  const a = await receiveStats(page);
  await sleep(secs * 1000);
  const b = await receiveStats(page);
  return { w: b.w, h: b.h, fps: (b.frames - a.frames) / secs, audioPerSec: (b.audioPackets - a.audioPackets) / secs };
}

// Abre o app Electron com uma pasta de dados própria (roda mesmo com o Lume aberto).
// Guarda as linhas "[captura]" que o processo principal registra.
async function launchApp() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-teste-dados-'));
  const args = [ROOT];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const app = await electron.launch({
    executablePath: require('electron'),
    args,
    env: { ...process.env, LUME_USER_DATA: userData },
  });
  app.captureLog = [];
  app.process().stdout.on('data', (d) => {
    for (const line of String(d).split('\n')) if (line.includes('[captura]')) app.captureLog.push(line.trim());
  });
  app.lastCapture = () => app.captureLog[app.captureLog.length - 1] || '';
  app.cleanup = async () => {
    try { await app.evaluate(({ app: a }) => a.exit(0)); } catch {}
    try { await app.close(); } catch {}
    fs.rmSync(userData, { recursive: true, force: true });
  };
  return app;
}

// Troca a lista de telas e janelas do sistema por uma lista simulada (o ambiente de teste
// não tem o que capturar). getList: lista de { id, name } avaliada a cada busca.
async function fakeSources(app, list) {
  await app.evaluate(({ desktopCapturer, nativeImage }, { items, png }) => {
    const img = nativeImage.createFromDataURL(png);
    global.__fakeSources = items;
    global.__sourceCalls = 0;
    desktopCapturer.getSources = async () => {
      global.__sourceCalls++;
      return global.__fakeSources.map((s) => ({ ...s, thumbnail: img, appIcon: s.id.startsWith('window:') ? img : null, display_id: '' }));
    };
  }, { items: list, png: PNG });
}

// Na tela inicial do app: cria uma sala local (sem link público) e entra nela
async function hostRoom(app, win, name = 'Luis') {
  const port = await freePort();
  await win.fill('#port', String(port));
  await win.uncheck('#tunnelChk');
  await win.click('#hostBtn');
  await win.waitForURL(`http://127.0.0.1:${port}/**`);
  await win.fill('#name', name);
  await win.click('#joinBtn');
  await win.waitForSelector('#app:not(.hidden)');
  return port;
}

module.exports = {
  ROOT, PNG, FAKE_SCREEN, sleep, freePort, startTestServer, launchBrowser, enterRoom,
  receiveStats, receiveRate, launchApp, fakeSources, hostRoom,
};
