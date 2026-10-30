'use strict';
// Atualizações: avisos, download e troca, usando o módulo ../updater.js.
// Consulta a última release no GitHub. Se houver versão nova, pergunta antes (aviso nativo do Windows,
// que nenhuma página consegue imitar ou disparar). Só funciona no app gerado (.exe), não no "npm start".
const fs = require('fs');
const path = require('path');
const { app, dialog, shell, net } = require('electron');
const updater = require('../updater');
const state = require('./state');
const { dialogParent, quitApp } = require('./window');

const UPDATE_FIRST_CHECK_MS = 10 * 1000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const updateStateFile = () => path.join(app.getPath('userData'), 'atualizacao.json');
const updateLogFile = () => path.join(app.getPath('userData'), 'atualizacao.log');
const updateLog = (msg) => updater.appendLog(updateLogFile(), msg);
const UPDATE_WORK_DIR = () => path.join(app.getPath('temp'), 'lume-atualizacao');
const askedThisSession = new Set();
let updateBusy = false;

function openUpdateLog() {
  if (fs.existsSync(updateLogFile())) shell.openPath(updateLogFile());
  else dialog.showMessageBox(dialogParent(), { type: 'info', title: 'Atualizações', message: 'Ainda não há registro de atualização.' });
}

function readUpdateState() {
  try { return JSON.parse(fs.readFileSync(updateStateFile(), 'utf8')); } catch { return {}; }
}
function writeUpdateState(s) {
  try { fs.writeFileSync(updateStateFile(), JSON.stringify(s)); } catch {}
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
  if (state.win && !state.win.isDestroyed()) state.win.setProgressBar(p);
  if (state.tray) state.tray.setToolTip(label || 'Lume');
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
  const workDir = UPDATE_WORK_DIR();
  updateLog(`atualizando v${app.getVersion()} -> v${info.version} (pasta: ${appDir})`);
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
    const zip = path.join(workDir, info.name);
    const dl = await updater.download(net.fetch, info, zip, (p) =>
      setUpdateProgress(p, `Lume – baixando atualização ${Math.round(p * 100)}%`));
    updateLog(`download ok: ${dl.bytes} bytes, SHA-256 ${dl.verifiedHash ? 'conferido' : 'não informado na release'}`);
    setUpdateProgress(2, 'Lume – preparando atualização…'); // 2 = barra "indeterminada"
    const newApp = await updater.extract(zip, path.join(workDir, 'novo'));
    updateLog('extraído em ' + newApp);
    // a versão nova assume a troca; só fechamos depois que ela confirmar que está rodando
    await updater.startApplyProcess({
      newExe: path.join(newApp, path.basename(process.execPath)),
      target: appDir, pid: process.pid, workDir, log: updateLog,
    });
    writeUpdateState({ ...readUpdateState(), pending: { from: app.getVersion(), to: info.version, at: Date.now() } });
    updateLog('fechando para o atualizador trocar os arquivos');
    quitApp();
  } catch (e) {
    updateLog('FALHA antes de fechar: ' + e.message);
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

// Resultado da última atualização, conferido na abertura seguinte. Não depende de quem reabriu o
// Lume: se a troca não aconteceu por qualquer motivo, a versão continua a antiga e o aviso aparece.
async function reportUpdateResult() {
  const st = readUpdateState();
  const p = st.pending;
  if (!p) return;
  delete st.pending;
  writeUpdateState(st);
  if (Date.now() - p.at > 24 * 60 * 60 * 1000) return;
  if (updater.compareVersions(app.getVersion(), p.to) >= 0) {
    updateLog(`aberto já na v${app.getVersion()}: atualização concluída`);
    dialog.showMessageBox(dialogParent(), { type: 'info', title: 'Lume', message: `Lume atualizado para a v${app.getVersion()}.` });
    return;
  }
  updateLog(`aberto ainda na v${app.getVersion()}: a atualização para a v${p.to} não foi concluída`);
  const { response } = await dialog.showMessageBox(dialogParent(), {
    type: 'warning', title: 'Lume',
    message: `A atualização para a v${p.to} não foi concluída. Você continua na v${app.getVersion()}.`,
    detail: 'Tente de novo pelo ícone da bandeja (Procurar atualizações) ou baixe a versão nova manualmente. ' +
      'O registro da atualização mostra em que etapa parou.',
    buttons: ['Abrir página de download', 'Ver registro', 'Fechar'], defaultId: 2, cancelId: 2, noLink: true,
  });
  if (response === 0) shell.openExternal(`https://github.com/${updater.REPO}/releases/latest`);
  if (response === 1) openUpdateLog();
}

// Sobras de atualizações anteriores: arquivos renomeados por estarem em uso e a pasta temporária
function cleanupAfterUpdate() {
  if (!updatesSupported()) return;
  setTimeout(() => {
    const n = updater.cleanupOldFiles(path.dirname(process.execPath));
    if (n) updateLog(`${n} arquivo(s) antigo(s) removido(s) da pasta do Lume`);
    try { fs.rmSync(UPDATE_WORK_DIR(), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(path.join(app.getPath('temp'), 'lume-atualizador-perfil'), { recursive: true, force: true }); } catch {}
  }, 15000);
}

function scheduleUpdateChecks() {
  if (!updatesSupported()) return;
  setTimeout(() => checkForUpdates(), UPDATE_FIRST_CHECK_MS);
  setInterval(() => checkForUpdates(), UPDATE_INTERVAL_MS);
}

module.exports = { checkForUpdates, openUpdateLog, reportUpdateResult, cleanupAfterUpdate, scheduleUpdateChecks };
