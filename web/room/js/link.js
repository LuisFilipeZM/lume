// Link da sala na barra de cima: mostrar e copiar.
import { S } from './state.js';
import { $, toast } from './util.js';

async function getLink() {
  let base = location.origin;
  if (window.electronAPI) {
    try { base = (await window.electronAPI.getPublicUrl()) || base; } catch {}
  }
  return {
    link: base + '/?room=' + encodeURIComponent(S.room),
    onlyHere: /^(127\.0\.0\.1|localhost)$/.test(new URL(base).hostname),
  };
}

export async function refreshLink() {
  const { link } = await getLink();
  $('#linkBox').value = link;
}

async function copyText(text) {
  if (window.electronAPI && window.electronAPI.copyText) return window.electronAPI.copyText(text);
  await navigator.clipboard.writeText(text);
}

export function setupLinkBar() {
  $('#linkBox').onclick = () => $('#linkBox').select();
  $('#copyBtn').onclick = async () => {
    const { link, onlyHere } = await getLink();
    $('#linkBox').value = link;
    try {
      await copyText(link);
      toast(onlyHere ? 'Link copiado, mas só funciona neste computador (sem link público).'
        : S.roomLocked ? 'Link copiado! A sala tem senha: mande a senha separadamente.' : 'Link copiado!');
    } catch {
      $('#linkBox').focus();
      $('#linkBox').select();
      toast('Não consegui copiar sozinho: o link está selecionado, aperte Ctrl+C.');
    }
  };
}
