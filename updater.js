'use strict';
// Atualizador do Lume: consulta a última release no GitHub, baixa o zip, confere e troca os arquivos.
//
// Como a troca funciona (Windows):
//   1. baixa o zip para uma pasta temporária e confere tamanho e SHA-256;
//   2. extrai com o tar.exe do próprio Windows;
//   3. grava um script PowerShell que espera o Lume fechar, copia a versão nova por cima
//      (robocopy, sem apagar nada que já esteja na pasta) e abre o Lume de novo;
//   4. o app fecha e o script assume.
//
// Requisitos de cada release (veja o README): tag vX.Y.Z, um anexo Lume-vX.Y.Z-win-x64.zip
// com a pasta "Lume" dentro, e o SHA-256 do zip nas notas.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

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

// Script que espera o Lume fechar, copia a versão nova por cima e abre de novo.
function buildReplaceScript({ pid, src, dst, workDir }) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"; // string literal do PowerShell
  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$src = ${q(src)}`,
    `$dst = ${q(dst)}`,
    `$work = ${q(workDir)}`,
    `$exe = Join-Path $dst 'Lume.exe'`,
    `Wait-Process -Id ${Number(pid)} -Timeout 60`,
    'Start-Sleep -Milliseconds 800',
    '$ok = $false',
    'for ($i = 0; $i -lt 10 -and -not $ok; $i++) {',
    '  # /E copia tudo (com subpastas) e não apaga arquivos que só existem no destino',
    '  robocopy $src $dst /E /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null',
    '  if ($LASTEXITCODE -lt 8) { $ok = $true } else { Start-Sleep -Seconds 2 }',
    '}',
    'if ($ok) {',
    '  Start-Process -FilePath $exe -ArgumentList "--updated"',
    '  Start-Sleep -Seconds 2',
    '  Remove-Item -Recurse -Force $work',
    '} else {',
    '  Start-Process -FilePath $exe -ArgumentList "--update-failed"',
    '}',
    '',
  ].join('\r\n');
}

// Grava o script (UTF-8 com BOM, para caminhos com acento) e o deixa rodando sozinho.
function launchReplaceScript(opts) {
  const file = path.join(opts.workDir, 'aplicar-atualizacao.ps1');
  fs.writeFileSync(file, '\ufeff' + buildReplaceScript(opts), 'utf8');
  const child = spawn('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file],
    { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return file;
}

module.exports = {
  REPO, parseVersion, compareVersions, parseRelease, checkLatest,
  download, extract, canWrite, buildReplaceScript, launchReplaceScript,
};
