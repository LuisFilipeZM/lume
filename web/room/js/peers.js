// Lista de pessoas na sala (lateral) e o botão de recolher.
import { $, store, load } from './util.js';
import { S } from './state.js';

export function renderPeers() {
  const ul = $('#peers');
  ul.innerHTML = '';
  const add = (name, live, me) => {
    const li = document.createElement('li');
    li.textContent = name + (me ? ' (você)' : '');
    if (live) {
      const b = document.createElement('span');
      b.className = 'live';
      b.textContent = 'AO VIVO';
      li.append(b);
    }
    ul.append(li);
  };
  add(S.myName, S.sharing, true);
  for (const p of S.peers.values()) add(p.name, p.sharing, false);
  $('#peopleCount').textContent = S.peers.size + 1;
}

// Recolher/mostrar a lista de pessoas. As telas crescem sozinhas: o layout reage ao novo tamanho.
export function setAsideCollapsed(collapsed) {
  $('#aside').classList.toggle('collapsed', collapsed);
  $('#peopleBtn').classList.toggle('active', !collapsed);
  store('ts-aside-collapsed', collapsed ? '1' : '0');
}

export function setupPeersPanel() {
  setAsideCollapsed(load('ts-aside-collapsed') === '1');
  $('#collapseBtn').onclick = () => setAsideCollapsed(true);
  $('#peopleBtn').onclick = () => setAsideCollapsed(!$('#aside').classList.contains('collapsed'));
}
