'use strict';
// Atualizador: versões, leitura da release, download conferido, extração e troca de arquivos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const u = require('../../updater');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const release = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'release-v1.9.0.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lume-teste-'));

test('compara versões como números, não como texto', () => {
  assert.ok(u.compareVersions('v1.10.0', '1.9.0') > 0);
  assert.ok(u.compareVersions('1.9.1', '1.10.0') < 0);
  assert.equal(u.compareVersions('1.9.0', 'v1.9.0'), 0);
  assert.equal(u.parseVersion('banana'), null);
});

test('lê a release publicada: versão, zip, tamanho e SHA-256 das notas', () => {
  const info = u.parseRelease(release);
  assert.equal(info.version, '1.9.0');
  assert.equal(info.name, 'Lume-v1.9.0-win-x64.zip');
  assert.equal(info.size, 158697545);
  assert.equal(info.sha256, 'f751eaed9ff02522f8c6098cdff5cc0a45cc3e9457c07573b1a94fb3109ceccb');
});

test('recusa releases que não servem para atualizar', () => {
  const foraDoRepo = { ...release, assets: [{ ...release.assets[0], browser_download_url: 'https://exemplo.com/Lume-v1.9.0-win-x64.zip' }] };
  assert.equal(u.parseRelease(foraDoRepo), null, 'download fora das releases do repositório');
  assert.equal(u.parseRelease({ ...release, draft: true }), null, 'rascunho');
  assert.equal(u.parseRelease({ ...release, prerelease: true }), null, 'pré-release');
  assert.equal(u.parseRelease({ ...release, tag_name: 'v2.0.0' }), null, 'zip com versão diferente da tag');
  assert.equal(u.parseRelease({ ...release, assets: [] }), null, 'sem o zip do Windows');
});

test('só oferece versões mais novas que a instalada', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => release });
  assert.equal((await u.checkLatest(fakeFetch, '1.8.0')).available, true);
  assert.equal((await u.checkLatest(fakeFetch, '1.9.0')).available, false);
  assert.equal((await u.checkLatest(fakeFetch, '1.10.0')).available, false);
  const semReleases = async () => ({ ok: false, status: 404 });
  assert.equal((await u.checkLatest(semReleases, '1.0.0')).available, false);
});

test('download: confere tamanho e SHA-256 e recusa arquivo corrompido ou incompleto', async (t) => {
  const zip = fs.readFileSync(path.join(FIXTURES, 'lume-falso.zip'));
  let corromper = false;
  const srv = http.createServer((req, res) => {
    const body = Buffer.from(zip);
    if (corromper) body[10] ^= 0xff;
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  }).listen(0, '127.0.0.1');
  t.after(() => srv.close());
  await new Promise((r) => srv.once('listening', r));

  const info = {
    url: `http://127.0.0.1:${srv.address().port}/z.zip`,
    size: zip.length,
    sha256: crypto.createHash('sha256').update(zip).digest('hex'),
  };
  const dest = path.join(tmp(), 'baixado.zip');
  let progresso = 0;
  const r = await u.download(fetch, info, dest, (p) => { progresso = p; });
  assert.equal(r.bytes, zip.length);
  assert.equal(r.verifiedHash, true);
  assert.equal(progresso, 1);

  corromper = true;
  await assert.rejects(u.download(fetch, info, dest), /SHA-256/);
  corromper = false;
  await assert.rejects(u.download(fetch, { ...info, size: zip.length + 10 }, dest), /incompleto/);
});

test('extração: encontra a pasta Lume com o Lume.exe', async () => {
  const dir = tmp();
  const app = await u.extract(path.join(FIXTURES, 'lume-falso.zip'), path.join(dir, 'novo'));
  assert.ok(fs.existsSync(path.join(app, 'Lume.exe')));
  await assert.rejects(u.extract(path.join(dir, 'nao-existe.zip'), path.join(dir, 'x')));
});

test('troca de arquivos: arquivo em uso é renomeado, arquivos extras são preservados', () => {
  const base = tmp();
  const src = path.join(base, 'novo');
  const dst = path.join(base, 'instalado');
  fs.mkdirSync(path.join(src, 'resources'), { recursive: true });
  fs.mkdirSync(path.join(dst, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(src, 'Lume.exe'), 'novo');
  fs.writeFileSync(path.join(src, 'resources', 'app.asar'), 'app novo');
  fs.writeFileSync(path.join(dst, 'Lume.exe'), 'antigo');
  fs.writeFileSync(path.join(dst, 'cloudflared.exe'), 'do usuário');

  // simula o Windows: a primeira cópia sobre o Lume.exe falha porque o arquivo está em uso
  let ocupado = true;
  const fsEmUso = { ...fs, copyFileSync: (s, d) => {
    if (ocupado && d.endsWith('Lume.exe')) { ocupado = false; throw Object.assign(new Error('em uso'), { code: 'EBUSY' }); }
    return fs.copyFileSync(s, d);
  } };
  u.copyTree(fsEmUso, src, dst, 123);

  assert.equal(fs.readFileSync(path.join(dst, 'Lume.exe'), 'utf8'), 'novo');
  assert.equal(fs.readFileSync(path.join(dst, 'Lume.exe.old-123'), 'utf8'), 'antigo');
  assert.equal(fs.readFileSync(path.join(dst, 'resources', 'app.asar'), 'utf8'), 'app novo');
  assert.equal(fs.readFileSync(path.join(dst, 'cloudflared.exe'), 'utf8'), 'do usuário');

  assert.equal(u.cleanupOldFiles(dst), 1, 'sobras .old são apagadas na abertura seguinte');
  assert.ok(!fs.existsSync(path.join(dst, 'Lume.exe.old-123')));
});

test('modo atualizador: destino inválido não copia nada e fica registrado', async () => {
  const base = tmp();
  const dados = path.join(base, 'dados');
  const code = await u.runApplyMode({
    argv: ['x', '--lume-apply-update', `--lume-target=${path.join(base, 'nao-existe')}`, '--lume-pid=999999', `--lume-work=${base}`],
    userDataDir: dados,
    execPath: path.join(base, 'Lume.exe'),
  });
  assert.equal(code, 1);
  const log = fs.readFileSync(path.join(dados, 'atualizacao.log'), 'utf8');
  assert.match(log, /FALHA ao aplicar/);
});

test('atualizador que não confirma (ex.: bloqueado pelo antivírus) gera erro em vez de fechar o app', async () => {
  const work = tmp();
  await assert.rejects(
    u.startApplyProcess({
      newExe: process.execPath, // processo que sai sem criar o marcador de "pronto"
      target: work, pid: process.pid, workDir: work, log: () => {}, readyTimeoutMs: 1500,
    }),
    /não começou a rodar/,
  );
});

test('detecta pasta sem permissão de escrita', () => {
  assert.equal(u.canWrite(tmp()), true);
  assert.equal(u.canWrite(path.join(tmp(), 'nao', 'existe')), false);
});
