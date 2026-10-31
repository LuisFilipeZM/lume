'use strict';
// Antes de entrar na sala de outra pessoa, confere se ela está na mesma versão do Lume.
// O servidor da sala responde em /versao. Salas de versões anteriores a essa checagem não
// respondem, e também são recusadas.

/** @param {string} v */
function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** @param {string} a @param {string} b @returns {number} */
function compare(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * @param {string} origin  origem da sala, ex.: https://abc.trycloudflare.com
 * @param {string} mine    versão deste Lume
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function checkRoomVersion(origin, mine, timeoutMs = 10000) {
  let res;
  try {
    res = await fetch(origin + '/versao', { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store', redirect: 'error' });
  } catch (err) {
    const tempo = err && /** @type {any} */ (err).name === 'TimeoutError';
    return { ok: false, error: tempo ? 'A sala não respondeu. Confira o link e tente de novo.' : 'Não foi possível conectar à sala. Confira o link e tente de novo.' };
  }
  /** @type {any} */
  let info = null;
  if (res.ok) {
    try { info = await res.json(); } catch {}
  }
  const theirs = info && info.app === 'lume' && typeof info.version === 'string' ? info.version : null;
  if (!theirs) {
    return {
      ok: false,
      error: `Esta sala é de uma versão antiga do Lume (o seu está na v${mine}). Todos precisam estar na mesma versão: peça para quem criou a sala atualizar.`,
    };
  }
  if (theirs === mine) return { ok: true };
  const c = compare(theirs, mine);
  const dica = c > 0
    ? 'Atualize o seu pelo ícone da bandeja → Procurar atualizações.'
    : 'Peça para quem criou a sala atualizar.';
  return { ok: false, error: `Versão diferente: a sala está no Lume v${theirs} e o seu está na v${mine}. ${dica}` };
}

module.exports = { checkRoomVersion, compare };
