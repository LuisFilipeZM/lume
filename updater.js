'use strict';
// Atualizador do Lume: consulta a última release no GitHub, baixa o zip, confere e troca os arquivos.
//
// Como a troca funciona (Windows):
//   1. baixa o zip para uma pasta temporária e confere tamanho e SHA-256;
//   2. extrai com o tar.exe do próprio Windows;
//   3. abre a VERSÃO NOVA (ainda na pasta temporária) em "modo atualizador";
//      ela avisa que está pronta, espera o Lume antigo fechar, copia os arquivos por cima
//      (sem apagar nada que já esteja na pasta) e abre o Lume atualizado;
//   4. o app antigo só fecha depois que o atualizador confirma que está rodando.
// Sem PowerShell nem scripts: antivírus costumam bloquear esse padrão em silêncio.
// Tudo fica registrado em atualizacao.log, na pasta de dados do Lume.
//
// Requisitos de cada release (veja o README): tag vX.Y.Z, um anexo Lume-vX.Y.Z-win-x64.zip
// com a pasta "Lume" dentro, e o SHA-256 do zip nas notas.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

// No Electron, o "fs" comum enxerga arquivos .asar como pastas. Para copiar o app.asar como arquivo,
// a troca usa o "original-fs" (fora do Electron, nos testes, cai no fs comum).
function rawFs() {
  try { return require('original-fs'); } catch { return fs; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REPO = 'LuisFilipeZM/lume';
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const ASSET_RE = /^Lume-v(\d+\.\d+\.\d+)-win-x64\.zip$/;
const SHA_RE = /SHA-?256[^\n]*?`([a-f0-9]{64})`/i;

// "v1.10.0" -> [1, 10, 0]
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// > 0 se a for mais nova que b
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Extrai da resposta da API o que interessa. Retorna null se a release não serve para atualizar.
function parseRelease(rel) {
  if (!rel || rel.draft || rel.prerelease) return null;
  const version = parseVersion(rel.tag_name);
  if (!version) return null;
  const asset = (rel.assets || []).find((a) => {
    const m = ASSET_RE.exec(a.name || '');
    return m && compareVersions(m[1], rel.tag_name) === 0 &&
      String(a.browser_download_url || '').startsWith(DOWNLOAD_PREFIX);
  });
  if (!asset) return null;
  const sha = SHA_RE.exec(rel.body || '');
  return {
    version: version.join('.'),
    name: asset.name,
    url: asset.browser_download_url,
    size: Number(asset.size) || 0,
    sha256: sha ? sha[1].toLowerCase() : null,
    page: rel.html_url || `https://github.com/${REPO}/releases/latest`,
  };
}

// Consulta a última release. fetchImpl: net.fetch do Electron (ou fetch, nos testes).
async function checkLatest(fetchImpl, currentVersion, apiUrl = API_LATEST) {
  const res = await fetchImpl(apiUrl, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) return { available: false, reason: 'sem releases' };
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  const info = parseRelease(await res.json());
  if (!info) return { available: false, reason: 'release sem o zip do Windows' };
  return { available: compareVersions(info.version, currentVersion) > 0, info };
}

// Baixa para dest conferindo tamanho e SHA-256. onProgress(0..1)
async function download(fetchImpl, info, dest, onProgress = () => {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetchImpl(info.url);
  if (!res.ok || !res.body) throw new Error(`download falhou (${res.status})`);
  const total = info.size || Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  let received = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (total) onProgress(Math.min(1, received / total));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (info.size && received !== info.size) {
    throw new Error(`arquivo incompleto (${received} de ${info.size} bytes)`);
  }
  const got = hash.digest('hex');
  if (info.sha256 && got !== info.sha256) {
    throw new Error('o arquivo baixado não confere com o SHA-256 da release');
  }
  return { bytes: received, sha256: got, verifiedHash: !!info.sha256 };
}

// Extrai o zip. No Windows usa o tar.exe nativo (Windows 10 1803+); fora dele, unzip (só para testes).
function extract(zipFile, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const [cmd, args] = process.platform === 'win32'
    ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zipFile, '-C', destDir]]
    : ['unzip', ['-q', '-o', zipFile, '-d', destDir]];
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err) => {
      if (err) return reject(new Error('falha ao extrair: ' + err.message));
      const appDir = path.join(destDir, 'Lume');
      if (!fs.existsSync(path.join(appDir, 'Lume.exe'))) {
        return reject(new Error('o zip não tem a pasta "Lume" com o Lume.exe'));
      }
      resolve(appDir);
    });
  });
}

// A pasta onde o Lume está precisa aceitar escrita (não funciona em "Arquivos de Programas").
function canWrite(dir) {
  const probe = path.join(dir, `.lume-update-test-${process.pid}`);
  try { fs.writeFileSync(probe, ''); fs.rmSync(probe, { force: true }); return true; }
  catch { return false; }
}

// ---------- registro (atualizacao.log) ----------
function appendLog(file, msg) {
  try {
    const f = rawFs();
    f.mkdirSync(path.dirname(file), { recursive: true });
    try { if (f.statSync(file).size > 256 * 1024) f.renameSync(file, file + '.1'); } catch {}
    f.appendFileSync(file, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

// Espera um processo terminar (true) ou o tempo acabar (false).
async function waitForExit(pid, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return true; }
    await sleep(300);
  }
  return false;
}

// Espera um arquivo aparecer (o atualizador cria "pronto" quando começa a rodar).
async function waitForFile(file, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return true;
    await sleep(200);
  }
  return false;
}

// Copia src para dst (com subpastas), sem apagar nada que só exista no destino.
// Arquivo em uso no destino: o Windows deixa RENOMEAR um arquivo em uso, então o antigo vira
// "nome.old-<n>" e o novo entra no lugar. As sobras são apagadas na próxima abertura do Lume.
function copyTree(f, src, dst, stamp) {
  f.mkdirSync(dst, { recursive: true });
  for (const ent of f.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isDirectory()) { copyTree(f, s, d, stamp); continue; }
    try {
      f.copyFileSync(s, d);
    } catch (e) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      f.renameSync(d, `${d}.old-${stamp}`);
      f.copyFileSync(s, d);
    }
  }
}

// Apaga sobras "*.old-<n>" de atualizações anteriores (melhor esforço).
function cleanupOldFiles(dir) {
  const f = rawFs();
  let removed = 0;
  const walk = (d) => {
    let ents; try { ents = f.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.old-\d+$/.test(ent.name)) { try { f.rmSync(p, { force: true }); removed++; } catch {} }
    }
  };
  walk(dir);
  return removed;
}

function argValue(argv, key) {
  const a = argv.find((x) => x.startsWith(`--${key}=`));
  return a ? a.slice(key.length + 3) : '';
}

// Inicia a versão nova em modo atualizador e espera ela confirmar que está rodando.
async function startApplyProcess({ newExe, target, pid, workDir, log }) {
  const ready = path.join(workDir, 'pronto');
  try { fs.rmSync(ready, { force: true }); } catch {}
  const child = spawn(newExe, [
    '--lume-apply-update', `--lume-target=${target}`, `--lume-pid=${pid}`, `--lume-work=${workDir}`,
  ], { detached: true, stdio: 'ignore', cwd: path.dirname(newExe), windowsHide: true });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  log(`atualizador iniciado (processo ${child.pid}); esperando confirmação`);
  if (!(await waitForFile(ready, 20000))) {
    try { child.kill(); } catch {}
    throw new Error('o atualizador não começou a rodar (pode ter sido bloqueado pelo antivírus)');
  }
  log('atualizador confirmou que está rodando');
}

// "Modo atualizador": roda a partir da pasta temporária, dentro da versão NOVA do Lume.
// Retorna o código de saída. Não abre janela nem ícone na bandeja.
async function runApplyMode({ argv, userDataDir, execPath, relaunchArgs = [] }) {
  const f = rawFs();
  const target = argValue(argv, 'lume-target');
  const workDir = argValue(argv, 'lume-work');
  const pid = Number(argValue(argv, 'lume-pid'));
  const src = path.dirname(execPath);
  const exe = path.basename(execPath);
  const logFile = path.join(userDataDir, 'atualizacao.log');
  const log = (m) => appendLog(logFile, m);

  log(`modo atualizador: copiar ${src} -> ${target}; esperando o processo ${pid} fechar`);
  try { f.writeFileSync(path.join(workDir, 'pronto'), String(process.pid)); } catch (e) { log('não consegui criar o marcador: ' + e.message); }

  let ok = false;
  try {
    if (!target || !f.existsSync(path.join(target, exe))) throw new Error('pasta de destino inválida: ' + target);
    if (!(await waitForExit(pid, 60000))) log('o Lume antigo não fechou em 60 s; tentando mesmo assim');
    await sleep(1000); // processos auxiliares do Electron terminam logo depois do principal
    const stamp = Date.now();
    for (let attempt = 1; ; attempt++) {
      try { copyTree(f, src, target, stamp); break; }
      catch (e) {
        log(`tentativa ${attempt} de copiar falhou: ${e.code || ''} ${e.message}`);
        if (attempt >= 10) throw e;
        await sleep(1500);
      }
    }
    ok = true;
    log('arquivos copiados com sucesso');
  } catch (e) {
    log('FALHA ao aplicar a atualização: ' + (e && e.message));
  }

  const flag = ok ? '--updated' : '--update-failed';
  try {
    const child = spawn(path.join(target, exe), [...relaunchArgs, flag], { detached: true, stdio: 'ignore', cwd: target });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    log(`Lume reaberto (${flag})`);
  } catch (e) {
    log('não consegui reabrir o Lume: ' + e.message + ' (abra o Lume manualmente)');
  }
  return ok ? 0 : 1;
}

module.exports = {
  REPO, parseVersion, compareVersions, parseRelease, checkLatest,
  download, extract, canWrite,
  appendLog, waitForExit, waitForFile, copyTree, cleanupOldFiles, startApplyProcess, runApplyMode,
};
