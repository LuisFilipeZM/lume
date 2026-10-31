# Desenvolvimento do Lume

Como rodar, testar e publicar o Lume a partir do código. Para o que o app faz e os riscos, veja o [README](README.md).

## Rodar a partir do código

### Requisitos

- Windows 10 versão 2004 ou mais novo, ou Windows 11
- [Node.js](https://nodejs.org) 18 ou superior
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), para o link público: `winget install --id Cloudflare.cloudflared`

### Rodar

```bash
npm install
npm start
```

- **Criar uma sala:** inicia o servidor. Deixe "Criar link público" marcado, entre na sala e clique em **Copiar link** para mandar aos amigos.
- **Entrar na sala de um amigo:** cole o link que ele te mandou.
- **Compartilhar:** clique em **Compartilhar tela**. O Lume abre o seletor: escolha a tela ou janela, confirme se quer o áudio e clique em **Compartilhar**. Na barra de baixo você ajusta qualidade, codec e prioridade (movimento ou nitidez).

## Gerar o executável

```bash
npm run dist
```

O resultado fica em `dist/Lume-win32-x64/`. Para distribuir, compacte **a pasta inteira**, porque o `Lume.exe` depende dos outros arquivos dela. Para que a atualização automática reconheça a release, siga o passo a passo em [Publicar uma versão nova](#publicar-uma-versão-nova).

## Como a atualização automática funciona

- **Quando verifica:** 10 segundos depois de abrir e a cada 6 horas. Também dá para pedir na hora, pelo ícone da bandeja, em **Procurar atualizações**.
- **O aviso:** se houver versão nova, aparece uma janela do Windows com **Atualizar agora**, **Depois**, **Pular esta versão** e **Ver novidades**. Nada é baixado sem você aceitar.
- **Ao atualizar:**
  1. o Lume baixa o zip da release e confere o tamanho e o SHA-256;
  2. extrai o zip e abre a **versão nova** em "modo atualizador" (sem janela). O Lume antigo só fecha depois que ela confirma que está rodando;
  3. a versão nova espera o Lume antigo fechar, copia os arquivos por cima e abre o Lume atualizado, que mostra "Lume atualizado para a vX.Y.Z".
  
  Arquivos que você colocou na pasta, como um `cloudflared.exe`, não são apagados. A troca não usa PowerShell nem scripts, padrão que antivírus costumam bloquear.
- **Se algo der errado:** você continua na versão atual. O aviso aparece na hora ou, se a troca for interrompida, na próxima vez que abrir o Lume, com a opção de baixar manualmente.
- **Registro:** cada etapa fica em `atualizacao.log`, na pasta de dados do Lume (`%APPDATA%\Lume`). Para abrir, use o ícone da bandeja → **Ver registro de atualização**.
- **Limitações:**
  - só funciona no `Lume.exe` gerado, não no `npm start`;
  - a pasta do Lume precisa aceitar escrita, então não funciona dentro de "Arquivos de Programas";
  - **quem está na v1.10.0 ou v1.11.0 precisa instalar a v1.11.1 manualmente uma vez.** O atualizador dessas versões não funcionava, e a correção só vale a partir da v1.11.1.

## Publicar uma versão nova

O GitHub Actions gera o executável e a release a partir de uma tag (`.github/workflows/release.yml`):

1. Atualize `"version"` no `package.json`, por exemplo `1.13.0`.
2. Escreva as novidades em `.github/release-notes.md`. As instruções de download e o aviso de segurança vêm de `.github/release-notes-rodape.md`.
3. Faça o commit, envie para a `main` e crie a tag com a mesma versão:
   ```bash
   git tag v1.13.0
   git push origin v1.13.0
   ```
4. Em **Actions**, o workflow **Release**:
   - confere se a tag bate com o `package.json`;
   - roda a verificação de tipos e os testes rápidos;
   - gera o `.exe`, compacta e calcula o SHA-256;
   - cria a release como **rascunho**.
5. Em **Releases**, confira o rascunho e clique em **Publish release**. Só depois de publicada a versão é oferecida pela atualização automática.

**Se precisar publicar à mão**, o atualizador só reconhece releases neste padrão:
- tag `vX.Y.Z`, sem marcar "pre-release";
- anexo `Lume-vX.Y.Z-win-x64.zip`, com a pasta **`Lume`** e o `Lume.exe` dentro;
- nas notas, a linha:
  ```
  SHA-256 de `Lume-vX.Y.Z-win-x64.zip`: `<hash>`
  ```

Para gerar o zip e o hash no PowerShell:
```powershell
npm run dist
Rename-Item dist\Lume-win32-x64 Lume
Compress-Archive -Path dist\Lume -DestinationPath dist\Lume-vX.Y.Z-win-x64.zip
Get-FileHash dist\Lume-vX.Y.Z-win-x64.zip -Algorithm SHA256
```

## Só o servidor, sem o app

```bash
npm run server
```

Abre em http://127.0.0.1:3000. Por padrão o servidor só aceita conexões desta máquina; para liberar a rede local, rode com `HOST=0.0.0.0` (no PowerShell: `$env:HOST='0.0.0.0'; npm run server`). Para compartilhar pelo navegador fora do seu PC é preciso HTTPS (por exemplo, `cloudflared tunnel --url http://127.0.0.1:3000`).

## Testes

Requer Node.js 22 ou mais novo.

```bash
npm run typecheck   # verificação de tipos do JavaScript (TypeScript, sem compilar nada)
npm test            # rápidos (segundos): servidor, senha, bloqueio, canais e atualizador
npm run test:e2e    # completos (~1 min): sala no navegador e app Electron, incluindo o seletor
npm run test:all    # tudo
```

- Os testes completos usam o Playwright. Na primeira vez, rode `npx playwright install chromium`.
- Eles abrem o app com uma pasta de dados própria, então funcionam mesmo com o Lume aberto.
- No GitHub, o workflow **Testes** (`.github/workflows/ci.yml`) roda tudo isso a cada envio para a `main` e em pull requests.
- **Verificação de tipos:** o `// @ts-check` não é usado arquivo a arquivo. As configurações ficam em `jsconfig.json` (app, servidor, atualizador) e `web/room/jsconfig.json` (página da sala), e o VS Code usa as mesmas para apontar erros enquanto você edita. Os tipos da API que o app oferece à página ficam em `web/room/types.d.ts`.
- **No Linux**, rode os completos com um servidor gráfico virtual: `xvfb-run -a npm run test:e2e`.

**O que fica de fora** (só dá para testar à mão, no Windows):
- a captura real da tela e do áudio por aplicativo;
- a troca de arquivos e a reabertura da atualização automática.

Nos testes, as telas e o áudio são simulados.

## Configuração

| O quê | Como |
|---|---|
| Porta | Na tela inicial do app, ou pela variável `PORT` no modo só servidor (padrão `3000`) |
| Servidor TURN | Variáveis `TURN_URL`, `TURN_USER` e `TURN_PASS` antes de iniciar. Só quem cria a sala precisa configurar |
| Ícone | Substitua `build/icon.ico` e `build/icon.png`. Há opções prontas em `build/alternativas/` |

## Estrutura

```
app/                    processo principal do Electron
  index.js              inicialização: modo atualizador, instância única, liga as partes
  ipc.js                todos os canais chamados pelas páginas e quem pode chamar cada um
  window.js             janela, bandeja e navegação (tela inicial <-> sala)
  room-host.js          servidor da sala nesta máquina e túnel público
  room-version.js       confere se a sala de outra pessoa está na mesma versão (/versao)
  updates.js            avisos e fluxo de atualização
  capture/picker.js     seletor de tela confiável (toda captura passa por ele)
  capture/app-audio.js  áudio por aplicativo
  state.js, paths.js    estado compartilhado e caminhos
preload.js              ponte segura entre as páginas e o app
picker.html             janela do seletor de tela
picker-preload.js       ponte do seletor, isolada da página da sala
server.js               servidor de sinalização (HTTP + WebSocket, salas e senha)
updater.js              atualização: consulta, download conferido, extração e troca de arquivos
start.html              tela inicial do app (criar ou entrar em sala)
web/room/                página da sala (servida pelo server.js, no app e no navegador)
  index.html, room.css  estrutura e visual
  js/main.js            entrada na sala, mensagens do servidor, liga as partes
  js/state.js           estado compartilhado e presets de qualidade
  js/signaling.js       conexão com o servidor
  js/share.js           compartilhar / parar
  js/rtc-send.js        envio para cada espectador (prévia, qualidade sob medida, codec)
  js/rtc-recv.js        recepção e o botão Assistir
  js/views.js           o que o espectador informa (tamanho, visibilidade, assistindo)
  js/pcm-audio.js       áudio por aplicativo (+ pcm-worklet.js)
  js/layout.js, peers.js, link.js, sounds.js, util.js
build/                  ícones do app e alternativas
tests/unit/             testes rápidos (node:test)
tests/e2e/              testes completos (Playwright: navegador e app Electron)
```

**A página da sala** usa módulos JavaScript nativos (`<script type="module">`), sem bundler nem etapa de build: o servidor entrega os arquivos de `web/room/` como estão. Ele só serve o que está dentro dessa pasta, só tipos conhecidos (`.html`, `.js`, `.css`, imagens) e recusa qualquer caminho que tente sair dela.

**Para adicionar um canal entre a página e o app:** declare-o na tabela de `app/ipc.js`, dizendo quem pode chamá-lo (`start` ou `room`), e exponha-o no `preload.js`. O teste `tests/unit/ipc.test.js` falha se os dois não baterem.
