## Download

**Se você já tem a v1.11.1 ou mais nova:** o próprio Lume avisa e atualiza sozinho. Ou clique com o botão direito no ícone da bandeja → **Procurar atualizações**.

**Se você tem a v1.11.0 ou anterior:** baixe **`Lume-{VERSAO}-win-x64.zip`** abaixo, feche o Lume (ícone da bandeja → **Sair**) e descompacte por cima da pasta antiga.

**Instalação nova:** descompacte numa pasta sua (Documentos, por exemplo) e abra `Lume.exe`.

**Requisitos:** Windows 10 versão 2004 ou mais novo, ou Windows 11.

**Primeira execução:**
- O Windows SmartScreen vai avisar "aplicativo não reconhecido", porque o executável não tem assinatura digital. Clique em **Mais informações → Executar assim mesmo**.
- O Firewall do Windows vai pedir permissão. Libere para redes privadas.
- Para gerar o link público da sala, instale o cloudflared: `winget install --id Cloudflare.cloudflared`

## ⚠️ Antes de usar

O Lume é um projeto pessoal, feito para amigos de confiança, e não passou por auditoria de segurança. Ao entrar pelo app na sala de outra pessoa, o código dela roda dentro do Lume. Ela não consegue capturar sua tela sem a sua escolha no seletor, mas recebe tudo o que você decidir compartilhar. A lista completa de riscos está no [README](https://github.com/LuisFilipeZM/lume#riscos-e-limitações).
