# Walkthrough — build e distribuição do PeerForum v2

Guia de referência rápido para montar, rodar e empacotar o PeerForum no
**desktop (Electron)** e no **mobile (Capacitor)**, incluindo o modo anônimo via
Tor. Tudo abaixo é executado a partir da **raiz do repositório**, salvo quando
indicado.

> Convenções: comandos de terminal em `bash`. No Windows use **PowerShell**; os
> exemplos específicos de Windows aparecem marcados com `<Windows>`.

---

## 0. Pré-requisitos

| Necessidade | Versão / observação |
| --- | --- |
| Node.js | **>= 22** (o projeto usa `node:sqlite`). Testado em Node 24. |
| npm | Vem com o Node (o repo usa workspaces). |
| Tor / Arti | Só para o modo anônimo (`--tor`). |
| Android Studio + JDK 17 | Só para build Android. |
| Xcode | Só para build iOS (macOS). |

Instale tudo de uma vez (isto também baixa Electron e Capacitor, porque
`apps/*` estão nos workspaces):

```bash
npm install
```

Verificações rápidas do projeto:

```bash
npm run typecheck   # tsc em todos os pacotes (root + web + desktop)
npm test            # 49 testes (unit + integração)
```

---

## 1. Rodar em desenvolvimento (navegador)

Dois terminais:

```bash
# Terminal 1 — nó + daemon local (API em http://127.0.0.1:7331)
npm run daemon -- --db ./peerforum.db --port 7331

# Terminal 2 — UI React (http://localhost:5173)
npm run web
```

No mesmo Wi-Fi, peers são descobertos via mDNS automaticamente. Para conectar
manualmente, copie o multiaddr impresso pela CLI e cole na aba **Peers**.

---

## 2. Modo anônimo (Tor) — CLI

### 2.1 Configurar o Tor

`torrc` (exemplo):

```
SocksPort 9050
HiddenServiceDir /var/lib/tor/pforum/
HiddenServicePort 80 127.0.0.1:4001
```

O `HiddenServicePort` encaminha o `.onion:80` para o listener local do libp2p
(`127.0.0.1:4001`).

### 2.2 Subir o nó anônimo

```bash
npm run daemon -- --tor \
  --onion-dir /var/lib/tor/pforum --onion-port 80 \
  --listen /ip4/127.0.0.1/tcp/4001 \
  --token "$PFORUM_TOKEN"
```

Referência de flags do daemon:

```
--db <path>            SQLite (default ./peerforum.db)
--port <n>             porta da API (default 7331)
--host <h>             bind da API (default 127.0.0.1)
--listen <multiaddr>   endereço de escuta libp2p (repetível)
--bootstrap <multiaddr> peer de bootstrap (repetível)
--no-mdns              desliga descoberta na LAN
--no-sync              desliga o loop de sincronização
--sync-interval <ms>   cadência de sync (default 15000)
--tor                  modo anônimo: dial + announce só por Tor (.onion)
--tor-socks <h:p>      proxy SOCKS5 do Tor (default 127.0.0.1:9050)
--onion <multiaddr>    endereço onion a anunciar (repetível)
--onion-dir <path>     diretório do HiddenService (lê o arquivo hostname)
--onion-port <n>       porta virtual do HiddenService (default 80)
--token <bearer>       exige Authorization: Bearer <token> na API
```

No modo Tor o nó **não** disca nem anuncia nenhum endereço clearnet: mDNS e
bootstrap são desligados e só endereços `.onion` são trocados.

---

## 3. Desktop (Electron)

O processo **main** do Electron é o servidor: sobe um `PFPNode` + daemon numa
porta loopback aleatória e serve o próprio UI na mesma origem (isso evita o
bloqueio de ES modules em `file://`).

### 3.1 Desenvolvimento (com live reload do UI)

```bash
# Terminal 1 — UI com hot reload
npm run web

# Terminal 2 — sobe o Electron apontando para o Vite
npm -w @pforum/desktop run dev
```

### 3.2 Smoke test (sem abrir janela)

Valida que a stack P2P (libp2p + `node:sqlite` + Fastify) roda **dentro do Node
do Electron**:

```bash
npm -w @pforum/desktop run smoke
# esperado: "desktop smoke OK — node … daemon :PORT + web UI"
```

### 3.3 Rodar o build de produção (sem instalador)

```bash
npm -w @pforum/desktop run build   # builda o UI + empacota o main
npm -w @pforum/desktop run start   # abre o app com o UI já embutido
```

### 3.4 Gerar instaladores

```bash
npm -w @pforum/desktop run dist
```

Saída em `apps/desktop/release/`:

- **Windows** → instalador NSIS (`PeerForum-2.0.0-setup.exe`)
- **macOS** → `PeerForum-2.0.0.dmg`
- **Linux** → `PeerForum-2.0.0.AppImage`

> Só é possível gerar o instalador do SO em que você está (ex.: `.dmg` exige
> macOS). Para gerar um build "desempacotado" rápido (sem instalador):

```bash
npx electron-builder --win --dir     # roda dentro de apps/desktop
```

### 3.5 App desktop em modo anônimo (Tor)

O app empacotado usa **variáveis de ambiente** (mesma semântica da CLI):

`<Windows PowerShell>`

```powershell
$env:PFORUM_TOR="1"
$env:PFORUM_ONION_DIR="C:\tor\pforum"   # pasta com o arquivo hostname
$env:PFORUM_ONION_PORT="80"
$env:PFORUM_TOR_SOCKS="127.0.0.1:9050"
.\apps\desktop\release\win-unpacked\PeerForum.exe
```

`<Linux/macOS>`

```bash
PFORUM_TOR=1 \
PFORUM_ONION_DIR=/var/lib/tor/pforum PFORUM_ONION_PORT=80 \
PFORUM_TOR_SOCKS=127.0.0.1:9050 \
./apps/desktop/release/PeerForum-2.0.0.AppImage
```

Outras variáveis suportadas: `PFORUM_DB`, `PFORUM_TOKEN`, `PFORUM_NO_SYNC`,
`PFORUM_DEV_URL`.

### 3.6 Arquivos que importam

```
apps/desktop/
  package.json            scripts: dev, smoke, build, dist
  electron-builder.yml    alvos de instalador + extraResources (UI)
  src/main.ts             sobe nó + daemon, cria a janela
  src/preload.ts          injeta window.__PF_API__
  scripts/build.mjs       esbuild (main.mjs + preload.cjs + smoke.mjs)
  scripts/run-smoke.mjs   roda o smoke no Node do Electron
  scripts/smoke.ts        teste de fumaça do runtime
```

---

## 4. Mobile (Capacitor)

O shell Capacitor empacota **o mesmo UI** em projetos nativos Android/iOS.

> ⚠️ **Limitação atual:** um WebView de celular não roda o nó Node.js/libp2p.
> Por enquanto o app **conecta em um daemon** via HTTP. Rodar o nó no próprio
> aparelho (nodejs-mobile ou WASM SQLite + transports browser) e passar por Tor
> (Orbot) é o próximo passo. Detalhes em `apps/mobile/README.md`.

### 4.1 Gerar/sincronizar os projetos nativos

```bash
# uma vez por plataforma
npm -w @pforum/mobile run add:android
npm -w @pforum/mobile run add:ios        # requer macOS + Xcode

# sempre que o UI mudar (builda o web e copia para os projetos nativos)
npm -w @pforum/mobile run sync
```

### 4.2 Abrir e compilar

```bash
npm -w @pforum/mobile run open:android      # abre no Android Studio
npm -w @pforum/mobile run open:ios          # abre no Xcode
npm -w @pforum/mobile run build:android     # sync + cap build android
npm -w @pforum/mobile run build:ios         # sync + cap build ios
```

### 4.3 Apontar o app para um nó

A URL da API é resolvida em runtime (`packages/web/public/pf-runtime.js`), nesta
ordem:

1. `window.__PF_API__` (injetado pelo shell nativo)
2. parâmetro de query `?api=<url>`
3. `localStorage["pf_api"]`

Para um teste em **LAN confiável** (não é anônimo, expõe IP), suba o daemon
acessível na rede **com token**:

```bash
npm run daemon -- --host 0.0.0.0 --port 7331 --token "$PFORUM_TOKEN"
```

E no device abra o app com `?api=http://<ip-do-seu-pc>:7331` (ou defina
`localStorage.pf_api`).

### 4.4 Arquivos que importam

```
apps/mobile/
  package.json          scripts: sync, add:*, open:*, build:*
  capacitor.config.ts   appId, appName, webDir
  README.md             detalhes do modo remoto e roadmap do nó on-device
```

---

## 5. Testes e verificação

```bash
npm run typecheck   # tsc root + web + desktop
npm test            # 49 testes (vitest)
npm -w @pforum/desktop run smoke   # runtime do Electron (nó + daemon + UI)
```

Suítes relevantes:

- `packages/node/test/integration.test.ts` — 3 nós reais convergindo por sync.
- `packages/node/test/networks.integration.test.ts` — convites e membership.
- `packages/node/test/tor.test.ts` — só anuncia `.onion`, recusa clearnet.
- `packages/node/test/daemon.test.ts` — API HTTP + bearer token.

---

## 6. Segurança — o que o anonimato garante (e o que não)

- Modo Tor esconde o **IP** dos outros membros e do **ISP** (o ISP só vê tráfego
  Tor; bridges escondem até isso).
- **Não** é anonimato 100%: correlação de timing/topologia continua possível.
- A **chave de autor é estável** → todos os posts ficam ligáveis à mesma pubkey
  (subchaves por rede = roadmap).
- Chaves privadas ainda são gravadas **em claro** no SQLite (keystore cifrado =
  roadmap).
- Modo LAN do mobile **não** é anônimo. Só use para teste funcional.

---

## 7. Troubleshooting

| Sintoma | Causa / solução |
| --- | --- |
| `node:sqlite` não encontrado | Use Node >= 22. O Electron 35 já traz Node 22.16 com `node:sqlite`. |
| Electron abre em branco / erro de CORS em module | O UI é servido pelo daemon (mesma origem). Não use `loadFile('...index.html')` com ES modules. |
| `Electron version "…" is a range` no electron-builder | Fixe a versão exata em `apps/desktop/package.json` (`"electron": "35.7.5"`). |
| `file source doesn't exist .../web/dist` | O `extraResources.from` é relativo a `apps/desktop` → use `../../packages/web/dist`. |
| `Dynamic require of "buffer" is not supported` | Falta o banner de `createRequire` no `scripts/build.mjs` (já configurado). |
| `cap: command not found` | Rode dentro de `apps/mobile` ou use `npm -w @pforum/mobile run …`. |
| Tor não conecta | Confira `SocksPort` ativo (`--tor-socks`) e o `HiddenServicePort` apontando para a porta do libp2p. |
| Porta da API ocupada | O desktop usa porta aleatória; na CLI, mude `--port`. |

---

## 8. Cheat sheet

```bash
# Dev (navegador)
npm run daemon -- --port 7331
npm run web

# Anônimo (CLI)
npm run daemon -- --tor --onion-dir /var/lib/tor/pforum --onion-port 80 --listen /ip4/127.0.0.1/tcp/4001

# Desktop
npm -w @pforum/desktop run dev
npm -w @pforum/desktop run smoke
npm -w @pforum/desktop run dist        # instaladores em apps/desktop/release/

# Mobile
npm -w @pforum/mobile run add:android
npm -w @pforum/mobile run sync
npm -w @pforum/mobile run open:android

# Qualidade
npm run typecheck
npm test
```
