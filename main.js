'use strict';
const { app, BrowserWindow, ipcMain, desktopCapturer, session, shell, clipboard, Tray, Menu, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { startServer } = require('./server');
const updater = require('./updater');

// Desempenho: não reduzir a prioridade do app quando outra janela (ex.: um jogo) está na frente
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Memória: não manter um processo de página "reserva" pré-carregado (o app só tem uma janela)
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess');

const START = path.join(__dirname, 'start.html');
// Ícone da janela/barra de tarefas. Para trocar, substitua os arquivos em build/
const ICON = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// Windows: agrupa na barra de tarefas com o ícone do app (e não o do Electron)
if (process.platform === 'win32') app.setAppUserModelId('com.lume.app');

// Só uma cópia do app por vez: abrir de novo apenas traz a janela existente para a frente
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => showWindow());

let tray = null;
let isQuitting = false;    // true quando o usuário escolhe "Sair" (aí sim fecha de verdade)
let trayHintShown = false; // avisa só na primeira vez que a janela vai para a bandeja

let win = null;
let serverHandle = null;
let tunnelProc = null;
let publicUrl = null;
let localUrl = null;
let allowedOrigin = null;   // única origem (a sala) autorizada a listar/capturar telas
let selectedSourceId = null;

// ---------- segurança dos comandos ----------
function senderUrl(e) {
  try { return e.senderFrame.url || ''; } catch { return ''; }
}
function requireStart(e) {
  if (!senderUrl(e).startsWith('file://')) throw new Error('não autorizado');
}
function requireRoom(e) {
  let o = '';
  try { o = new URL(senderUrl(e)).origin; } catch {}
  if (!allowedOrigin || o !== allowedOrigin) throw new Error('não autorizado');
}

// ---------- túnel público (opcional, via cloudflared) ----------
function findCloudflared() {
  const names = ['cloudflared.exe', 'cloudflared'];
  const dirs = [path.dirname(process.execPath), __dirname, process.cwd()];
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

// ---------- janela ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 720,
    minHeight: 500,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    title: 'Lume',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,     // memória: sem corretor ortográfico (e sem baixar dicionários)
      enableWebSQL: false,
    },
  });

  // saiu da sala ou a página recarregou: encerra a captura de áudio
  win.webContents.on('did-start-navigation', (details) => { if (details.isMainFrame) stopAppAudio(); });
  win.webContents.on('render-process-gone', stopAppAudio);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (ev, url) => {
    if (url.startsWith('file://')) return;
    let o = '';
    try { o = new URL(url).origin; } catch {}
    if (o !== allowedOrigin) ev.preventDefault();
  });

  win.loadFile(START);

  // Fechar a janela = esconder na bandeja (o compartilhamento e a sala continuam)
  win.on('close', (ev) => {
    if (isQuitting) return;
    ev.preventDefault();
    win.hide();
    if (!trayHintShown && tray && process.platform === 'win32') {
      trayHintShown = true;
      tray.displayBalloon({
        iconType: 'info',
        title: 'Lume',
        content: 'O Lume continua rodando aqui. Para fechar de vez, clique com o botão direito e escolha "Sair".',
      });
    }
  });
  win.on('closed', () => { win = null; });

  // Avisa a página quando a janela some (bandeja/minimizada) ou volta,
  // para ela pausar o vídeo que não está sendo visto e economizar GPU/rede.
  const notifyVisibility = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('window-visibility', win.isVisible() && !win.isMinimized());
  };
  for (const ev of ['hide', 'show', 'minimize', 'restore']) win.on(ev, notifyVisibility);
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function createTray() {
  tray = new Tray(ICON);
  tray.setToolTip('Lume');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Lume v${app.getVersion()}`, enabled: false },
    { label: 'Abrir Lume', click: showWindow },
    { label: 'Procurar atualizações', click: () => checkForUpdates({ manual: true }) },
    { type: 'separator' },
    { label: 'Sair', click: quitApp },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

function goStart(query) {
  allowedOrigin = null;
  return win.loadFile(START, query ? { query } : undefined);
}

// ---------- atualizações ----------
// Consulta a última release no GitHub. Se houver versão nova, pergunta antes (aviso nativo do Windows,
// que nenhuma página consegue imitar ou disparar). Só funciona no app gerado (.exe), não no "npm start".
const UPDATE_FIRST_CHECK_MS = 10 * 1000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const updateStateFile = () => path.join(app.getPath('userData'), 'atualizacao.json');
const askedThisSession = new Set();
let updateBusy = false;

function readUpdateState() {
  try { return JSON.parse(fs.readFileSync(updateStateFile(), 'utf8')); } catch { return {}; }
}
function writeUpdateState(s) {
  try { fs.writeFileSync(updateStateFile(), JSON.stringify(s)); } catch {}
}
function dialogParent() {
  return win && !win.isDestroyed() && win.isVisible() ? win : undefined;
}
function updatesSupported() {
  return app.isPackaged && process.platform === 'win32';
}

async function checkForUpdates({ manual = false } = {}) {
  if (!updatesSupported()) {
    if (manual) dialog.showMessageBox(dialogParent(), { type: 'info', title: 'Atualizações', message: 'As atualizações só funcionam no Lume.exe gerado (npm run dist), no Windows.' });
    return;
  }
  if (updateBusy) return;
  let r;
  try {
    r = await updater.checkLatest(net.fetch, app.getVersion());
  } catch (e) {
    if (manual) dialog.showMessageBox(dialogParent(), { type: 'warning', title: 'Atualizações', message: 'Não consegui verificar se há versão nova.', detail: e.message });
    return;
  }
  if (!r.available) {
    if (manual) dialog.showMessageBox(dialogParent(), { type: 'info', title: 'Atualizações', message: `Você já está na versão mais recente (v${app.getVersion()}).` });
    return;
  }
  const info = r.info;
  if (!manual && (askedThisSession.has(info.version) || readUpdateState().skip === info.version)) return;
  askedThisSession.add(info.version);

  const mb = info.size ? ` (${Math.round(info.size / 1048576)} MB)` : '';
  const { response } = await dialog.showMessageBox(dialogParent(), {
    type: 'info',
    title: 'Atualização do Lume',
    message: `Nova versão disponível: v${info.version}`,
    detail: `Você está usando a v${app.getVersion()}.\n\n` +
      `Ao atualizar, o Lume baixa a versão nova${mb}, fecha e abre de novo sozinho. ` +
      'Se você estiver numa sala ou compartilhando a tela, a conexão será encerrada.',
    buttons: ['Atualizar agora', 'Depois', 'Pular esta versão', 'Ver novidades'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) return runUpdate(info);
  if (response === 2) writeUpdateState({ ...readUpdateState(), skip: info.version });
  if (response === 3) shell.openExternal(info.page);
}

function setUpdateProgress(p, label) {
  if (win && !win.isDestroyed()) win.setProgressBar(p);
  if (tray) tray.setToolTip(label || 'Lume');
}

async function runUpdate(info) {
  const appDir = path.dirname(process.execPath);
  if (!updater.canWrite(appDir)) {
    const { response } = await dialog.showMessageBox(dialogParent(), {
      type: 'warning', title: 'Atualização do Lume',
      message: 'Não tenho permissão para atualizar a pasta do Lume.',
      detail: `${appDir}\n\nMova a pasta do Lume para um local seu (por exemplo, Documentos) ou baixe a versão nova manualmente.`,
      buttons: ['Abrir página de download', 'Fechar'], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (response === 0) shell.openExternal(info.page);
    return;
  }
  updateBusy = true;
  const workDir = path.join(app.getPath('temp'), 'lume-atualizacao');
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
    const zip = path.join(workDir, info.name);
    await updater.download(net.fetch, info, zip, (p) =>
      setUpdateProgress(p, `Lume – baixando atualização ${Math.round(p * 100)}%`));
    setUpdateProgress(2, 'Lume – preparando atualização…'); // 2 = barra "indeterminada"
    const newApp = await updater.extract(zip, path.join(workDir, 'novo'));
    updater.launchReplaceScript({ pid: process.pid, src: newApp, dst: appDir, workDir });
    quitApp(); // o script espera o Lume fechar, troca os arquivos e abre de novo
  } catch (e) {
    updateBusy = false;
    setUpdateProgress(-1);
    const { response } = await dialog.showMessageBox(dialogParent(), {
      type: 'error', title: 'Atualização do Lume',
      message: 'A atualização não pôde ser concluída. Você continua na versão atual.',
      detail: e.message,
      buttons: ['Abrir página de download', 'Fechar'], defaultId: 1, cancelId: 1, noLink: true,
    });
    if (response === 0) shell.openExternal(info.page);
  }
}

// Mensagem depois de uma atualização (o script reabre o Lume com --updated ou --update-failed)
function reportUpdateResult() {
  if (process.argv.includes('--updated')) {
    dialog.showMessageBox(dialogParent(), { type: 'info', title: 'Lume', message: `Lume atualizado para a v${app.getVersion()}.` });
  } else if (process.argv.includes('--update-failed')) {
    dialog.showMessageBox(dialogParent(), {
      type: 'warning', title: 'Lume',
      message: `A atualização não pôde ser aplicada. Você continua na v${app.getVersion()}.`,
      detail: 'Feche outros programas que possam estar usando a pasta do Lume e tente de novo pelo menu da bandeja (Procurar atualizações), ou baixe a versão nova manualmente.',
    });
  }
}

function scheduleUpdateChecks() {
  if (!updatesSupported()) return;
  setTimeout(() => checkForUpdates(), UPDATE_FIRST_CHECK_MS);
  setInterval(() => checkForUpdates(), UPDATE_INTERVAL_MS);
}

ipcMain.handle('get-version', (e) => {
  requireStart(e);
  return app.getVersion();
});

// ---------- áudio por aplicativo (Windows 10 versão 2004 ou mais nova / Windows 11) ----------
// Janela compartilhada: captura só o som do processo dono da janela (e dos processos filhos dele).
// Tela inteira: captura todo o som do PC, menos o do próprio Lume (evita eco de quem você está assistindo).
let appAudio = null;        // captura ativa (loopback-capture)
let getWindowPid = null;    // GetWindowThreadProcessId, carregada sob demanda

function windowPid(hwnd) {
  if (!getWindowPid) {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    getWindowPid = user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)');
  }
  const out = [null];
  getWindowPid(hwnd, out);
  return Number(out[0]) || 0;
}

function stopAppAudio() {
  if (!appAudio) return;
  try { appAudio.stop(); } catch {}
  appAudio = null;
}

function startAppAudio(sourceId, target) {
  if (process.platform !== 'win32') return { ok: false, error: 'só no Windows' };
  stopAppAudio();
  let LoopbackCapture;
  try { ({ LoopbackCapture } = require('loopback-capture')); }
  catch (e) { return { ok: false, error: 'módulo de áudio indisponível: ' + e.message }; }

  const send = (chunk) => {
    if (!target.isDestroyed()) target.send('app-audio-data', chunk);
  };
  try {
    const capture = new LoopbackCapture();
    const m = /^window:(\d+):/.exec(String(sourceId));
    if (m) {
      const pid = windowPid(Number(m[1]));
      if (!pid) return { ok: false, error: 'não encontrei o programa dessa janela' };
      capture.start(pid, true, send);           // só este aplicativo (e seus processos filhos)
      appAudio = capture;
      return { ok: true, mode: 'app' };
    }
    capture.start(process.pid, false, send);    // tela inteira: tudo, exceto o próprio Lume
    appAudio = capture;
    return { ok: true, mode: 'system' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('app-audio-start', (e, sourceId) => {
  requireRoom(e);
  return startAppAudio(sourceId, e.sender);
});

ipcMain.handle('app-audio-stop', (e) => {
  requireRoom(e);
  stopAppAudio();
});

// ---------- comandos vindos das páginas ----------
ipcMain.handle('host-start', async (e, opts = {}) => {
  requireStart(e);
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
  localUrl = `http://127.0.0.1:${serverHandle.port}`;
  allowedOrigin = new URL(localUrl).origin;

  let warning = null;
  if (opts.tunnel && !publicUrl) {
    win.webContents.send('status', 'Criando link público…');
    const r = await startTunnel(localUrl);
    if (r.error) warning = r.error;
  }
  return { ok: true, publicUrl: opts.tunnel ? publicUrl : null, warning };
});

ipcMain.handle('open-host', async (e) => {
  requireStart(e);
  if (!localUrl) return;
  allowedOrigin = new URL(localUrl).origin;
  await win.loadURL(localUrl);
});

ipcMain.handle('join', async (e, raw) => {
  requireStart(e);
  const text = String(raw || '').trim();
  let u = null;
  for (const candidate of [text, 'https://' + text]) {
    try { u = new URL(candidate); break; } catch {}
  }
  if (!u || !/^https?:$/.test(u.protocol)) return { ok: false, error: 'Link inválido.' };

  allowedOrigin = u.origin;
  try {
    await win.loadURL(u.toString());
  } catch (err) {
    await goStart({ error: 'Não foi possível abrir o link: ' + err.message });
  }
  return { ok: true };
});

ipcMain.handle('go-home', async (e) => {
  requireRoom(e);
  await goStart();
});

ipcMain.handle('copy-text', (e, text) => {
  requireRoom(e);
  clipboard.writeText(String(text).slice(0, 2000));
  return true;
});

ipcMain.handle('get-public-url', (e) => {
  requireRoom(e);
  return publicUrl;
});

ipcMain.handle('get-sources', async (e) => {
  requireRoom(e);
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});

ipcMain.handle('select-source', (e, id) => {
  requireRoom(e);
  selectedSourceId = String(id);
});

// ---------- inicialização ----------
app.whenReady().then(() => {
  if (!gotLock) return;
  // getDisplayMedia(): usa a tela/janela escolhida no seletor e liga o áudio do sistema (Windows)
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      // sem miniaturas: aqui só precisamos do id (gerar miniaturas de todas as janelas custa CPU/memória)
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const src = sources.find((s) => s.id === selectedSourceId) || sources.find((s) => s.id.startsWith('screen:'));
      selectedSourceId = null;
      if (!src) return callback({});
      callback({ video: src, audio: request.audioRequested ? 'loopback' : undefined });
    } catch {
      callback({});
    }
  }, { useSystemPicker: false });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['fullscreen', 'display-capture', 'clipboard-sanitized-write'].includes(permission));
  });

  createWindow();
  createTray();
  win.webContents.once('did-finish-load', reportUpdateResult);
  scheduleUpdateChecks();
  app.on('activate', showWindow);
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  isQuitting = true; // cobre também desligar o Windows e o "Sair" da bandeja
  stopAppAudio();
  try { if (tray) tray.destroy(); } catch {}
  try { if (tunnelProc) tunnelProc.kill(); } catch {}
  try { if (serverHandle) serverHandle.close(); } catch {}
});
