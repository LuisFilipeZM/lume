'use strict';
// A sala no navegador: espectadores, prévia e "Assistir", senha e lista lateral.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sleep, startTestServer, launchBrowser, enterRoom, receiveRate } = require('./helpers');

let srv;
let browser;
test.before(async () => {
  srv = await startTestServer();
  browser = await launchBrowser();
});
test.after(async () => {
  await browser.close();
  srv.close();
});

const tileState = (page) => page.evaluate(() => {
  const t = document.querySelector('.tile');
  return t && { preview: t.classList.contains('preview'), muted: t.querySelector('video').muted };
});

test('compartilhar: prévia leve por padrão, Assistir libera qualidade total e áudio', { timeout: 90000 }, async () => {
  const ana = await enterRoom(browser, srv.base, 'cinema', 'Ana', { share: true });
  const bia = await enterRoom(browser, srv.base, 'cinema', 'Bia');
  await ana.waitForSelector('#app:not(.hidden)');
  await bia.waitForSelector('#app:not(.hidden)');
  await ana.check('#audioChk');
  await ana.click('#shareBtn');
  await bia.waitForSelector('.tile video');
  await sleep(4000);

  // 1) prévia: pequena, poucos quadros, sem áudio
  assert.deepEqual(await tileState(bia), { preview: true, muted: true });
  let r = await receiveRate(bia);
  assert.ok(r.h > 0 && r.h <= 200, `prévia em baixa resolução (${r.w}x${r.h})`);
  assert.ok(r.fps <= 4, `prévia com poucos quadros (${r.fps}/s)`);
  assert.equal(r.audioPerSec, 0, 'prévia sem áudio');
  assert.match(await ana.innerText(`#tile-${await ana.evaluate(() => myId)} .label`), /ninguém assistindo/);

  // 2) Assistir: resolução maior, ~30 quadros por segundo e áudio
  await bia.click('.tile .overlay button');
  await sleep(6000);
  assert.deepEqual(await tileState(bia), { preview: false, muted: false });
  r = await receiveRate(bia);
  assert.ok(r.h >= 360, `qualidade total (${r.w}x${r.h})`);
  assert.ok(r.fps >= 20, `vídeo fluido (${r.fps}/s)`);
  assert.ok(r.audioPerSec >= 40, `áudio chegando (${r.audioPerSec} pacotes/s)`);
  assert.match(await ana.innerText(`#tile-${await ana.evaluate(() => myId)} .label`), /1 pessoa assistindo/);

  // 3) ✕ volta para a prévia
  await bia.hover('.tile');
  await bia.click('.tile .stopBtn');
  await sleep(4000);
  assert.deepEqual(await tileState(bia), { preview: true, muted: true });
  r = await receiveRate(bia);
  assert.equal(r.audioPerSec, 0, 'de volta à prévia, sem áudio');

  // 4) quem entra depois também começa na prévia
  const caio = await enterRoom(browser, srv.base, 'cinema', 'Caio');
  await caio.waitForSelector('.tile video');
  assert.equal((await tileState(caio)).preview, true);

  // 5) parar de compartilhar remove a tela para todos
  await ana.click('#shareBtn');
  await sleep(1000);
  assert.equal(await bia.locator('.tile').count(), 0);
  assert.equal(await caio.locator('.tile').count(), 0);

  for (const p of [ana, bia, caio]) assert.deepEqual(p.errors, []);
});

test('senha: erro aparece no formulário e a senha certa entra', { timeout: 30000 }, async () => {
  const ana = await enterRoom(browser, srv.base, 'secreta', 'Ana', { password: 'pizza42' });
  await ana.waitForSelector('#app:not(.hidden)');
  assert.ok(await ana.isVisible('#lockBadge'), 'cadeado no topo');
  assert.equal(await ana.inputValue('#pass'), '', 'a senha não fica no formulário');

  const bia = await enterRoom(browser, srv.base, 'secreta', 'Bia');
  await bia.waitForSelector('#joinErr:not(.hidden)');
  assert.match(await bia.innerText('#joinErr'), /tem senha/);

  await bia.fill('#pass', 'errada');
  await bia.click('#joinBtn');
  await bia.waitForFunction(() => /incorreta/.test(document.querySelector('#joinErr').textContent));
  assert.ok(await bia.isEnabled('#joinBtn'));

  await bia.fill('#pass', 'pizza42');
  await bia.click('#joinBtn');
  await bia.waitForSelector('#app:not(.hidden)');
  assert.match(await bia.innerText('#peers'), /Ana/);

  // o campo de senha tem o mesmo visual dos outros
  const estilo = (p, id) => p.evaluate((i) => { const s = getComputedStyle(document.getElementById(i)); return [s.backgroundColor, s.borderTopColor, s.borderRadius, s.paddingTop].join(); }, id);
  assert.equal(await estilo(bia, 'pass'), await estilo(bia, 'name'));
});

test('lista de pessoas: recolhe, as telas crescem e a escolha fica salva', { timeout: 30000 }, async () => {
  const ana = await enterRoom(browser, srv.base, 'lado', 'Ana', { viewport: { width: 1280, height: 720 } });
  await ana.waitForSelector('#app:not(.hidden)');
  await ana.evaluate(() => { for (let i = 0; i < 2; i++) tileFor('x' + i, 't' + i, true); updateEmpty(); });
  await sleep(300);
  const largura = () => ana.evaluate(() => Math.round(document.querySelector('.tile').getBoundingClientRect().width));
  const antes = await largura();
  await ana.click('#collapseBtn');
  await sleep(300);
  assert.equal(await ana.isVisible('#aside'), false);
  assert.ok((await largura()) > antes, 'telas ficaram maiores');

  await ana.reload();
  await ana.fill('#name', 'Ana');
  await ana.click('#joinBtn');
  await ana.waitForSelector('#app:not(.hidden)');
  assert.equal(await ana.isVisible('#aside'), false, 'continua recolhida depois de recarregar');
  await ana.click('#peopleBtn');
  assert.equal(await ana.isVisible('#aside'), true);
});
