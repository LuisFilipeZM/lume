# Lume

Compartilhamento de tela com áudio entre amigos, estilo Discord. Existe em duas formas, com a mesma interface:

- **App desktop (Electron)**: recomendado para quem compartilha. Captura até 1080p60, áudio do sistema automático (Windows), seletor de tela/janela próprio, sem exigir HTTPS.
- **Navegador**: quem só quer assistir abre o link, sem instalar nada.

## App desktop

Requer Node.js 18+.

```
npm install
npm start
```

Na tela inicial:

- **Criar uma sala**: inicia o servidor no seu PC. Com "Criar link público" marcado, o app abre um túnel HTTPS automaticamente (precisa do `cloudflared`, veja abaixo) e o botão **Copiar link** passa a copiar o endereço público. Mande esse link para os amigos.
- **Entrar na sala de um amigo**: cole o link da sala (funciona também em sala criada por outra pessoa).

### Bandeja

Fechar a janela (X) não encerra o Lume: ele vai para a bandeja do Windows (perto do relógio) e a sala e o compartilhamento continuam. Clique no ícone para abrir de novo; para fechar de vez, clique com o botão direito e escolha **Sair**. Abrir o Lume outra vez enquanto ele já está rodando só traz a janela de volta.

### Desempenho

- Quem compartilha codifica para cada espectador só a resolução que ele precisa (tela pequena na grade = vídeo menor; tela cheia = qualidade total, nunca abaixo de 360p).
- Com a janela escondida na bandeja ou minimizada, o vídeo para de ser enviado para você (o áudio continua) e volta sozinho ao reabrir.
- A prévia da própria tela usa uma cópia leve (baixa resolução, 5 fps); os amigos continuam recebendo a qualidade escolhida.
- No Gerenciador de Tarefas, `npm start` aparece como "Electron"; o `.exe` gerado por `npm run dist` aparece como "Lume".

### Gerar o .exe

```
npm run dist
```

O programa fica em `dist\Lume-win32-x64\Lume.exe`. Para mandar para os amigos, compacte a pasta `Lume-win32-x64` inteira em um .zip (o .exe depende dos outros arquivos da pasta).

### Ícone

O ícone em uso fica em `build/`: `icon.ico` (janela no Windows e o .exe) e `icon.png` (outros sistemas). O padrão é o monograma L.

Em `build/alternativas/` há outras opções prontas (cada uma com `.ico` e `.png`). Para trocar, copie o par escolhido para `build/` com os nomes `icon.ico` e `icon.png`. Para usar um desenho seu, faça o mesmo; o `.ico` deve ter vários tamanhos dentro (16 a 256 px). Depois rode `npm start` ou `npm run dist` de novo.

### cloudflared (link público)

```
winget install --id Cloudflare.cloudflared
```

Reabra o app depois de instalar. Alternativa sem instalar: baixe o `cloudflared.exe` e coloque na mesma pasta do `Lume.exe`.

Sem o cloudflared o app funciona normalmente, mas só amigos na mesma rede conseguem entrar (usando `http://SEU-IP:3000`, somente para assistir).

## Só o servidor (sem app)

```
npm run server
```

Abre http://localhost:3000. Para compartilhar pelo navegador fora do seu PC é preciso HTTPS, por exemplo `cloudflared tunnel --url http://127.0.0.1:3000`.

## Observações

- Vídeo e áudio vão direto entre os computadores (P2P); o servidor só faz a sinalização.
- Quem compartilha envia um fluxo para cada espectador: com 4 espectadores a 1080p30 (5 Mbps) são ~20 Mbps de upload. Ajuste a qualidade na barra de baixo.
- Codec: **H.264** (padrão) costuma usar o encoder da placa de vídeo e alivia a CPU. Se der problema de imagem, troque para VP9 ou automático.
- O áudio compartilhado é tudo que toca no PC. Se você ouvir a transmissão de outro amigo enquanto compartilha, o som dele volta para ele (eco): use fones e deixe só uma pessoa compartilhar áudio por vez.
- Amigos que não conseguem conectar (CGNAT, rede corporativa) precisam de um servidor TURN (ex.: coturn). Defina `TURN_URL`, `TURN_USER` e `TURN_PASS` antes de iniciar o app/servidor.
- Porta do servidor standalone: variável `PORT` (padrão 3000).
