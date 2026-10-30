'use strict';
// O app Electron: tela inicial, seletor de tela confiável e bandeja.
// No Linux, rode com um servidor gráfico virtual: xvfb-run -a npm run test:e2e
const test = require('node:test');
const assert = require('node:assert/strict');
const { sleep, startTestServer, launchApp, fakeSources, hostRoom } = require('./helpers');

const SOURCES = [
  { id: 'screen:0:0', name: 'Tela inteira' },
  { id: 'window:42:0', name: 'Jogo <b>legal</b>' },
];
const capture = (win, fn) => win.evaluate(fn); // roda dentro da página da sala

test('tela inicial mostra a versão e a sala não tem acesso às funções de captura', { timeout: 60000 }, async (t) => {
  const app = await launchApp();
  t.after(() => app.cleanup());
  const win = await app.firstWindow();
  await win.waitForFunction(() => document.querySelector('#ver').textContent.length > 0);
  const { version } = require('../../package.json');
  assert.match(await win.innerText('#ver'), new RegExp(`v${version.replace(/\./g, '\\.')}`));

  await hostRoom(app, win);
  const api = await capture(win, () => Object.keys(window.electronAPI));
  for (const proibida of ['getSources', 'selectSource', 'startAppAudio']) assert.ok(!api.includes(proibida), proibida);
  assert.equal(await capture(win, () => typeof window.picker), 'undefined');
  // forma antiga do Electron de capturar a tela
  const legado = await capture(win, () => navigator.mediaDevices.getUserMedia({
    audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'screen:0:0' } },
  }).then(() => 'capturou', (e) => e.name));
  assert.notEqual(legado, 'capturou');
});

test('seletor confiável: abre no clique, cancela, recusa repetição e libera só o escolhido', { timeout: 90000 }, async (t) => {
  const app = await launchApp();
  t.after(() => app.cleanup());
  const win = await app.firstWindow();
  await win.waitForSelector('#hostBtn');
  await fakeSources(app, SOURCES);
  await hostRoom(app, win);

  // pedido feito por um timer, sem clique recente (a "ativação" do clique dura ~5 s)
  const semClique = await capture(win, () => new Promise((res) => setTimeout(() => {
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => res('capturou'), (e) => res(e.name));
  }, 6000)));
  assert.notEqual(semClique, 'capturou');
  assert.equal(app.windows().length, 1, 'nenhum seletor abriu');

  let abriu = app.waitForEvent('window');
  await win.click('#shareBtn');
  let picker = await abriu;
  await picker.waitForSelector('.src');
  assert.match(await picker.innerText('#who'), /sua sala/);
  assert.deepEqual(await picker.locator('.src .name span').allInnerTexts(), ['Tela inteira', 'Jogo <b>legal</b>'], 'nomes como texto');
  assert.ok(await picker.isDisabled('#okBtn'), 'só libera depois de escolher');

  await picker.click('#cancelBtn');
  await sleep(500);
  assert.match(await win.innerText('#shareBtn'), /Compartilhar/);
  assert.ok(app.captureLog.some((l) => /cancelado/.test(l)));

  await win.click('#shareBtn'); // logo após cancelar: ignorado
  await sleep(400);
  assert.equal(app.windows().length, 1);
  assert.match(app.lastCapture(), /logo após cancelar/);
  await sleep(2000);

  abriu = app.waitForEvent('window');
  await win.click('#shareBtn');
  picker = await abriu;
  await picker.waitForSelector('.src');
  await picker.locator('.src', { hasText: 'Jogo' }).click();
  await picker.click('#okBtn');
  await sleep(1000);
  assert.ok(app.captureLog.some((l) => /permitido: window:42:0/.test(l)), app.lastCapture());
});

test('seletor: Atualizar mostra janelas abertas depois e mantém a escolha', { timeout: 60000 }, async (t) => {
  const app = await launchApp();
  t.after(() => app.cleanup());
  const win = await app.firstWindow();
  await win.waitForSelector('#hostBtn');
  await fakeSources(app, SOURCES);
  await hostRoom(app, win);

  const abriu = app.waitForEvent('window');
  await win.click('#shareBtn');
  const picker = await abriu;
  await picker.waitForSelector('.src');
  await picker.locator('.src', { hasText: 'Tela inteira' }).click();

  await app.evaluate(() => { global.__fakeSources.push({ id: 'window:99:0', name: 'Meu Jogo' }); });
  await picker.click('#refreshBtn');
  await picker.waitForFunction(() => [...document.querySelectorAll('.src .name span')].some((s) => s.textContent === 'Meu Jogo'));
  assert.equal(await picker.evaluate(() => document.querySelector('.src.sel').title), 'Tela inteira', 'escolha mantida');

  const antes = await app.evaluate(() => global.__sourceCalls);
  await picker.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(800);
  assert.ok((await app.evaluate(() => global.__sourceCalls)) > antes, 'voltar ao seletor atualiza sozinho');

  await picker.locator('.src', { hasText: 'Meu Jogo' }).click();
  await picker.click('#okBtn');
  await sleep(1000);
  assert.ok(app.captureLog.some((l) => /permitido: window:99:0/.test(l)), app.lastCapture());
});

test('seletor: sala de outra pessoa mostra o aviso com o endereço dela', { timeout: 60000 }, async (t) => {
  const outra = await startTestServer();
  const app = await launchApp();
  t.after(async () => { await app.cleanup(); outra.close(); });
  const win = await app.firstWindow();
  await win.waitForSelector('#hostBtn');
  await fakeSources(app, SOURCES);

  await win.fill('#url', `${outra.base}/?room=dela`);
  await win.click('#joinBtn');
  await win.waitForURL(`${outra.base}/**`);
  await win.fill('#name', 'Luis');
  await win.click('#joinBtn');
  await win.waitForSelector('#app:not(.hidden)');

  const abriu = app.waitForEvent('window');
  await win.click('#shareBtn');
  const picker = await abriu;
  await picker.waitForSelector('#who');
  assert.equal(await picker.locator('#who.remote').count(), 1);
  const aviso = await picker.innerText('#who');
  assert.match(aviso, /outra pessoa/);
  assert.ok(aviso.includes(`127.0.0.1:${outra.port}`));

  await picker.keyboard.press('Escape').catch(() => {}); // a janela fecha durante o comando
  await sleep(500);
  assert.match(app.lastCapture(), /cancelado/);
  assert.equal(await capture(win, () => window.electronAPI.getShareInfo()), null);
});

test('fechar a janela manda o Lume para a bandeja, sem encerrar', { timeout: 60000 }, async (t) => {
  const app = await launchApp();
  t.after(() => app.cleanup());
  const win = await app.firstWindow();
  await win.waitForSelector('#hostBtn');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await sleep(400);
  const estado = await app.evaluate(({ BrowserWindow }) => ({ janelas: BrowserWindow.getAllWindows().length, visivel: BrowserWindow.getAllWindows()[0].isVisible() }));
  assert.deepEqual(estado, { janelas: 1, visivel: false });
  assert.equal(app.process().exitCode, null, 'o app continua rodando');
});
