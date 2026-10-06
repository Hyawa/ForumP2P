# PeerForum (PFP v2)

**PeerForum é software livre e de código aberto (open-source) para comunidades
anônimas e descentralizadas.** Sem servidor, sem cadastro, sem hospedagem.

A modern, serverless, peer-to-peer forum. This is a clean TypeScript rewrite of
[saintthor/PeerForum](https://github.com/saintthor/PeerForum) (a 2015 Python 2
project, "a p2p forum with no server needed"), keeping its core ideas —
**decentralized keypair identity**, **content-addressed signed posts**, and
**set-reconciliation sync over a gossip network** — while replacing the
hand-rolled crypto and HTTP polling with modern primitives.

PeerForum P2P v2 tem que ser um grupo fechado, anonimo e totalmente descentralizado onde ninguem sabe quem é quem. Detalhe ele pode ser usado para criar qualquer tipo de comunidade totalmente anonima e descentralizada. Imagina uma comunidade onde pessoas querem se reunir para falar sobre carros, eles criam um fork do PeerForum, enviam os convites de uma pessoa para outra e controla quem entra quem sai como se fosse um grupo privado no whatsapp só que sem servidor central e totalmente P2P e esse grupo pode ter quantos membros quiser

> Status: MVP. Identity, signed posts, topics-as-trees, peer discovery and P2P
> synchronization work end to end, plus an anonymous (Tor) mode. Moderation,
> labels-as-votes and search are follow-ups.

## Uma internet livre, anônima e descentralizada

O PeerForum existe para provar uma coisa: dá para conversar, organizar
comunidades e trocar ideias em uma **internet livre, anônima e descentralizada**
— sem servidores, sem donos e sem vigilância. Ele é **100% open-source** e foi
feito para ser usado, estudado, modificado e copiado por qualquer pessoa.

- **Sem servidor central.** Não existe empresa, nuvem ou autoridade no meio do
  caminho. Cada pessoa roda o próprio nó e os dados vivem no aparelho de cada
  membro.
- **Sem cadastro.** Nada de e-mail, telefone ou login. Sua identidade é uma
  chave criptográfica gerada no seu próprio dispositivo.
- **Sem hospedagem.** Você **não precisa hospedar em lugar nenhum** — não há
  nada para alugar, configurar ou "subir no ar".
- **Anônimo por design.** No [modo Tor](#anonymous-mode-tor) todo o tráfego
  passa pela rede Tor e **nenhum membro vê o IP de outro**.
- **P2P de verdade.** As mensagens circulam direto entre os membros
  (*peer-to-peer*), com criptografia no transporte. Se um peer cai, a rede
  continua.

Em resumo: **é totalmente anônimo e totalmente P2P, e não precisa de servidor.**

## Código aberto, feito para ser forkado

Este repositório é aberto e colaborativo: leia, estude, critique, melhore e
**faça um fork**. Quer uma comunidade com a sua cara? É simples:

- **Faça um fork** do projeto e mude o que quiser.
- **Mude a aparência** (cores, logo, nome, textos) editando o UI em
  [`packages/web`](packages/web) — é React + Vite.
- **Mude o comportamento** no protocolo e no nó em
  [`packages/protocol`](packages/protocol), [`packages/core`](packages/core) e
  [`packages/node`](packages/node).
- **Gere o seu próprio instalador** com `npm -w @pforum/desktop run dist` — o
  passo a passo está em [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md).

Você também pode simplesmente **baixar uma versão e mexer no código**: o projeto
é seu. Quanto mais gente forkando e contribuindo, mais forte fica a rede.

## Vídeo de apresentação

> 🎬 **Vídeo de apresentação (YouTube):** _em breve_.

<!--
TODO: ao publicar o vídeo, substitua a linha acima por um embed, por exemplo:

[![Assista ao PeerForum em ação](screenshots/video-thumbnail.png)](https://www.youtube.com/watch?v=SEU_VIDEO_ID)
-->

## Screenshots

<!--
Coloque as capturas em screenshots/ (nomes sugeridos abaixo) e descomente o
bloco para exibi-las. Enquanto não houver imagens, mantemos este aviso.

| Tela inicial | Criar uma network | Convite via QR | Conversa |
| --- | --- | --- | --- |
| ![Tela inicial](screenshots/desktop.png) | ![Criar network](screenshots/criar-network.png) | ![Convite QR](screenshots/convite-qr.png) | ![Conversa](screenshots/conversa.png) |
-->

📸 As capturas de tela ficam em [`screenshots/`](screenshots). Adicione os
arquivos `desktop.png`, `criar-network.png`, `convite-qr.png` e `conversa.png` e
descomente o bloco acima para mostrá-las aqui.

## Como usar (passo a passo)

Você **não precisa hospedar nada, criar conta ou saber programar**. É só instalar
e convidar.

### Passo 1 — Baixe o app para desktop

Acesse a página de **[Releases](../../releases)** do repositório no GitHub e
baixe o instalador do seu sistema:

- **Windows:** `PeerForum-2.0.0-setup.exe`
- **macOS:** `PeerForum-2.0.0.dmg`
- **Linux:** `PeerForum-2.0.0.AppImage`

### Passo 2 — Instale e abra

No Windows, execute o `.exe` e siga o instalador. Ao abrir, o PeerForum já cria
sua **identidade anônima** e sobe um **nó** na sua própria máquina — sem servidor
e sem nuvem.

### Passo 3 — Crie sua "pool" (grupo / network)

Na aba **Networks**, clique em **Criar network** e dê um nome à sua comunidade
(ex.: *"Galera dos Carros"*). Pronto: você é o dono e administra quem entra e
quem sai, como num grupo privado.

### Passo 4 — Convide seus amigos (peers)

Gere um **convite** (com validade e limite de usos) e compartilhe o **código**
ou o **QR code**. Seu amigo abre o PeerForum dele, cola o código (ou lê o QR) e
entra na sua rede — virando um **peer** conectado direto a você, **sem servidor
no meio**.

### Passo 5 — Converse

Publique tópicos e responda. O conteúdo se replica automaticamente entre os
membros pela rede P2P e chega a todos.

> 🔒 **Para ficar anônimo de verdade:** rode o app em **modo Tor**
> (veja [Anonymous mode](#anonymous-mode-tor)). Assim nem os outros membros nem
> o seu provedor sabem com quem você fala.

## How decentralization works

There is **no server, no coordinator and no operator** anywhere in the system.
Every participant runs a full node ("peer"), and the whole forum is the union of
what peers replicate to each other.

- **Peer-to-peer topology.** Nodes connect directly to each other over libp2p
  (TCP/WebSocket, or Tor in anonymous mode). There is no backend to go down, no
  central database, and no privileged node: any peer can join, leave or be
  unreachable without breaking the rest.
- **Data lives on every member's device.** Each node stores the full content it
  knows in a local SQLite database (`node:sqlite`). Nothing is hosted for you —
  your machine *is* the server.
- **Content-addressed, signed posts.** An article's id is
  `sha256(canonical(payload))`, and the payload is signed by its author. Every
  peer independently **re-verifies the hash and the Ed25519 signature** before
  storing anything, so no trust in a middleman is required and tampering changes
  the id.
- **Sync by set reconciliation over a gossip network.** Peers exchange topic
  *snapshots* and then transfer only the missing delta, walking the article tree
  (see [Sync](#sync--set-reconciliation-on-an-article-tree)). New peers are
  discovered via libp2p `identify`, mDNS on a LAN, bootstrap addresses and peer
  gossip — there is no central registry or DNS.
- **Self-sovereign communities.** A **network** is defined by a signed,
  append-only **roster log** (a hash chain of `create`/`add`/`remove`/`setRole`
  ops). Membership is derived by folding that log (`foldRoster`) on every node,
  so everyone computes the same member list independently. Owners and admins are
  just roles in the log — there is no central authority.
- **Invites instead of sign-ups.** Access is granted by a signed, expiring,
  use-limited **invite code** (`PFPJOIN1.…`) shared person-to-person as text or
  QR. No email, phone number or account provider is involved.
- **Verifiable, not trusted.** Because identity is a keypair and content is
  signed, "who can post/read" is enforced cryptographically by each node, not by
  a server deciding for you.

## How anonymity is protected

The design treats anonymity as **layered**: pseudonymous identity, encrypted
transport, and — for network-level anonymity — routing every connection through
Tor so that peers never see each other's IP.

| Layer | What it protects | How |
| --- | --- | --- |
| **No accounts** | No real-world identity to begin with | Identity is a locally generated **Ed25519 keypair** — no email, phone or OAuth. You are a public key. |
| **Encrypted transport** | Content and authenticity in transit | libp2p **Noise** encrypts and authenticates every connection (plus Tor when enabled). |
| **Network anonymity** | Your **IP address** | In `--tor` mode all dialing goes through a local Tor SOCKS5 proxy and peers are addressed only by `.onion` (a custom `@pforum/tor` libp2p transport). Tor onion services hide **both sides**. |
| **No IP leakage** | Accidental deanonymization | mDNS and clearnet bootstrap are disabled; only `/onion3/…` multiaddrs are announced, shared in `/pforum/hello` and embedded in invites; `addPeer` rejects clearnet addresses and no IP is persisted. |
| **Closed membership** | Who can read/serve content | Networks are invite-only; sync is scoped by `network_id` and non-members are refused. |
| **Local-first control** | Exposure of your node | Keys stay on your disk; the control API binds to `127.0.0.1` and supports an optional bearer token (`--token`). |

**Threat model (what this buys you):**

- Other members cannot learn your IP — they only ever see a `.onion` address.
- Your ISP cannot see *who* you talk to inside the forum; it only sees Tor
  traffic (using [bridges](https://support.torproject.org/glossary/bridge/) hides
  even that you use Tor).
- A passive network observer watching one hop cannot map your posts to your
  location.

**Honest limits (what it does *not* do):**

- It is **not "100% anonymity."** Tor resists correlation but cannot defeat a
  global passive adversary that observes both ends of a circuit.
- The **author key is stable**, so all of one user's posts are linkable to the
  same public key (and across networks). Per-network unlinkable subkeys are on
  the [roadmap](#roadmap).
- Timing and traffic-pattern metadata still exist.
- Private keys are currently stored **unencrypted** on disk (roadmap: encrypted
  keystore).

See [Anonymous mode (Tor)](#anonymous-mode-tor) for setup steps.

## What changed vs. the original

| Concept | Original PeerForum (2015) | PFP v2 (this repo) |
| --- | --- | --- |
| User identity | RSA-2048, MD5 signatures | **Ed25519** (via `@noble/ed25519`) |
| Node identity | RSA-1024 + custom cipher | **libp2p PeerID** (Ed25519) |
| Transport | Custom XOR stream + RSA per message over HTTP POST | **libp2p** transports + **Noise** (encrypted & authenticated) |
| Article ID | `SHA1(canonical JSON)` | **SHA-256** of canonical payload |
| Wire format | `chr(code) + JSON` (newline batches) | Length-framed **CBOR** envelopes over protocol streams |
| Peer discovery | Address exchange + `SearchAddr` hop search | libp2p **identify**, **mDNS**, bootstrap, peer gossip |
| Sync | `SHA1(sorted ids)` snapshot + leaf diff | Same **snapshot + leaf reconciliation**, refreshed |
| Storage | SQLite | SQLite (built-in `node:sqlite`) |
| UI | bottle.py + jQuery | **React** SPA talking to a local daemon |

The transport is already encrypted and authenticated by libp2p/Noise, so (unlike
the original) there is no per-message encryption or node signing. **Article
authorship signatures remain** — that is the non-negotiable core.

## Repository layout

```
packages/
  protocol/   PFP v2 wire types, canonical JSON, hashing, Ed25519, CBOR codec, zod schemas
  core/       identity + SQLite storage + Article/Topic model + reconciliation engine
  node/       libp2p composition, stream handlers, sync loop, local daemon API (Fastify + SSE)
  web/        React + Vite UI
apps/
  desktop/    Electron shell — runs a full node and serves the UI as a desktop app
  mobile/     Capacitor shell — native Android/iOS wrapper around the web UI
```

## The protocol (PFP v2)

Every wire message is a CBOR envelope `{ p, t, m }` (`p` = protocol version,
`t` = millisecond timestamp, `m` = body), length-framed on the stream. Three
libp2p protocols:

| Protocol ID | Messages | Purpose |
| --- | --- | --- |
| `/pforum/sync/1.0.0` | `GetTopicHeads` → `TopicHeads`; `GetPosts{have}` → `Posts` | Discover topics and transfer only missing articles |
| `/pforum/peers/1.0.0` | `GetPeers` → `Peers` | Gossip known peers |
| `/pforum/timeline/1.0.0` | `GetUserPosts` → `Posts` | Follow a user's posts in a time window |

### Articles

An article's identity is its content: `id = sha256(canonical(payload))`, and the
payload is signed by its author. The **same** article has the same id on every
peer, and any mutation changes the id.

```jsonc
{
  "v": 2,
  "type": 0,                 // 0 normal, 1 like, 2 chat
  "content": "...",
  "rootId": null,            // null for a root; topic id for replies
  "parentId": null,          // direct parent within the tree
  "labels": ["tag"],
  "createTime": 1700000000000,
  "destroyTime": null,       // optional expiry (ephemeral posts)
  "author": "<ed25519 pubkey hex>",
  "id": "<sha256 hex>",
  "signature": "<ed25519 sig hex>"
}
```

### Sync = set reconciliation on an article tree

A **topic** is a tree of articles rooted at a signed root post. Each topic has a
`snapshot = sha256(sorted article ids)`.

1. Exchange topic heads (id, count, snapshot, lastTime).
2. For any topic whose snapshot differs, the requester sends its **leaf ids**.
3. The responder reconstructs what the requester can already reach by walking
   those leaves' ancestry, and returns everything else.
4. Received articles are re-verified (id + signature) before storage; peer
   reputation (`level`) is adjusted on success/failure.

This mirrors the original `Topic.ChkByLeaves` and lets peers transfer only the
delta, even when content arrives out of order.

## Networks — invite-only groups

A **network** is a closed community: content is namespaced to it, membership is
an explicit list, and only members can serve or read its topics. Think of a
WhatsApp group with no central server.

### Model

- **Owner-centric with admins.** The creator is the owner. Owners and admins can
  add/remove members; only the owner can change roles or remove admins.
- **Signed roster log.** Membership is an append-only log of signed ops
  (`create`, `add`, `remove`, `setRole`) forming a hash chain. Every member can
  audit it. The current members are derived by folding it (`foldRoster`).
- **Person identity, not node identity.** Members are identified by their
  Ed25519 **user** key. Each node proves which user it acts for with a signed
  `/pforum/hello` binding (`user_sign("pforum-hello@2" + peerId + addrs)`), so
  membership is enforced per person regardless of which machine they use.
- **Invite codes.** A signed, expiring, use-limited bearer token:
  `PFPJOIN1.<base64url(canonical JSON)>`. Sharing it displays as **text or a QR
  image**; the receiver pastes the code (the web UI shows the QR).
- **Namespace per network.** `articles`/`topics` carry a `network_id`; sync is
  scoped and refuses non-members.

### Flow

1. You create a network → a signed `create` op makes you the owner.
2. Generate an invite (choose expiry + max uses) → get a code + QR.
3. Your friend joins with the code: their node dials you, proves its user, and
   you sign an `add` op admitting them; the full roster is returned.
4. Both nodes sync that network's topics (`GetTopicHeads{networkId}` /
   `GetPosts{networkId}`), gated by membership.
5. Remove a member → a signed `remove` op is appended and pushed to peers; the
   removed node is refused on future syncs.

### What "expulsion" can and cannot do

This is fundamental P2P, not a limitation of the implementation:

| Goal | Achievable? | How |
| --- | --- | --- |
| Stop syncing with them | ✅ | `remove` op + local block |
| They cannot read **future** posts | ⚠️ Not yet | Requires group encryption + key rotation (roadmap) |
| Delete posts they already downloaded | ❌ | Impossible; the data is on their disk |
| Stop them re-sharing old posts | ❌ | They hold the plaintext |
| Expel them from the **whole** network | ⚠️ | Only if every member applies the `remove` op |

In short: removal revokes **future access**, not the past. This MVP is the
"control who syncs" model; encryption comes later if you need real confidentiality.

## Running it

Requires **Node.js >= 22** (uses the built-in `node:sqlite`). This repo uses npm
workspaces (pnpm was unavailable in the dev environment; the layout is
pnpm-compatible if you prefer).

```bash
npm install

# Terminal 1: start a local node + daemon API
npm run daemon -- --db ./peerforum.db --port 7331

# Terminal 2: start the web UI (http://localhost:5173)
npm run web
```

The CLI prints your multiaddrs. Share one with a friend; in the UI's **Peers**
tab, paste their multiaddr and click **Connect**, then **Sync now**. Peers on the
same LAN are also discovered automatically via mDNS.

### CLI options

```
--db <path>            SQLite file (default ./peerforum.db)
--port <n>             daemon API port (default 7331)
--host <h>             daemon bind host (default 127.0.0.1)
--listen <multiaddr>   libp2p listen address (repeatable)
--bootstrap <multiaddr> bootstrap peer (repeatable)
--no-mdns              disable local-network discovery
--no-sync              disable the periodic sync loop
--sync-interval <ms>   sync cadence (default 15000)
--tor                  anonymous mode: dial + announce only via Tor (.onion)
--tor-socks <h:p>      Tor SOCKS5 proxy (default 127.0.0.1:9050)
--onion <multiaddr>    onion address to announce, e.g. /onion3/<id>/tcp/80 (repeatable)
--onion-dir <path>     HiddenService dir; reads its `hostname` file
--onion-port <n>       HiddenService virtual port (default 80, with --onion-dir)
--token <bearer>       require `Authorization: Bearer <token>` on the daemon API
```

## Anonymous mode (Tor)

In `--tor` mode the node never dials or announces a clearnet address: mDNS and
bootstrap are disabled, all outbound connections go through a local Tor SOCKS5
proxy (an `@pforum/tor` libp2p transport), and only `.onion` multiaddrs are
announced, shared in `/pforum/hello`, and embedded in invite codes. A peer can
therefore reach you without ever learning your IP, and your ISP only sees Tor
traffic.

1. Run Tor (or [Arti](https://arti.torproject.org/)) with a SOCKS port and a
   hidden service that forwards to the node's loopback listener:

   ```
   SocksPort 9050
   HiddenServiceDir /var/lib/tor/pforum/
   HiddenServicePort 80 127.0.0.1:4001
   ```

2. Start the node in anonymous mode (reads the onion host from the
   HiddenService `hostname` file):

   ```bash
   npm run daemon -- --tor \
     --onion-dir /var/lib/tor/pforum --onion-port 80 \
     --listen /ip4/127.0.0.1/tcp/4001 --token "$PFORUM_TOKEN"
   ```

3. Share your `/onion3/...` multiaddr (printed at startup) or invite code.
   Invites carry the onion address, so joining peers dial you through Tor.

> **Scope.** This hides IP addresses from other members and from network
> observers; it is not "100% anonymity". Timing/topology correlation and the
> stable author key (all posts linkable to one pubkey) remain, and per-network
> unlinkable identities are still a follow-up. Private keys are also still
> stored in plaintext.

## Desktop and mobile apps

Two packaging targets live under `apps/`. Both reuse the same UI; the desktop
app additionally **runs the node itself**. A step-by-step build/distribution
guide lives in [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md).

### Desktop (Electron)

The Electron main process starts a full `PFPNode` + daemon on a random loopback
port and serves the built UI from that same origin (Chromium blocks ES modules
over `file://`, so serving over HTTP keeps everything same-origin). Your machine
is the server — the packaged app needs no backend.

```bash
npm install
npm -w @pforum/desktop run dev      # develop (expects `npm run web` on :5173)
npm -w @pforum/desktop run smoke    # boots node + daemon under Electron's Node
npm -w @pforum/desktop run dist     # build installers into apps/desktop/release/
```

`electron-builder` produces an NSIS installer on Windows, a `.dmg` on macOS and
an AppImage on Linux. To ship an **anonymous** build, launch it with the Tor
environment variables (same semantics as the CLI flags):

```bash
PFORUM_TOR=1 \
PFORUM_ONION_DIR=/var/lib/tor/pforum PFORUM_ONION_PORT=80 \
PFORUM_TOR_SOCKS=127.0.0.1:9050 \
peerforum
```

Other overrides: `PFORUM_DB`, `PFORUM_TOKEN`, `PFORUM_NO_SYNC`.

### Mobile (Capacitor)

The Capacitor shell bundles the web UI into native Android/iOS projects. A phone
WebView cannot run the Node.js/libp2p node, so for now the app connects to a
**PeerForum daemon over HTTP** (set `?api=<url>` or `localStorage.pf_api`; see
`apps/mobile/README.md`). Running the full node on-device (embedded Node runtime
or WASM SQLite + browser libp2p transports) and routing it through Tor (Orbot)
are the next milestones.

```bash
npm -w @pforum/mobile run add:android   # once
npm -w @pforum/mobile run add:ios       # once, macOS
npm -w @pforum/mobile run sync          # build web UI + copy into native projects
npm -w @pforum/mobile run open:android  # or open:ios
```

## Local daemon API

Bound to `127.0.0.1` by default.

```
GET  /status                       node + identity summary
GET  /identity                     user key, peer id, multiaddrs
GET  /topics?network=<id|public>   list topics (all / public / one network)
POST /topics                       { content, labels?, networkId? } -> create a root post
GET  /topics/:id                   topic + full article tree
POST /topics/:id/reply             { content, parentId? }
GET  /peers                        known peers
POST /peers                        { address } -> dial a multiaddr
POST /sync                         run a sync round now
GET  /users/:author/posts          user timeline
GET  /events                       SSE stream of newly stored articles
GET  /networks                     networks you know, with your role
POST /networks                     { name } -> create a network
GET  /networks/:id                 network + members + your role
POST /networks/:id/invites         { expiresInMs?, maxUses? } -> { code }
POST /networks/join                { code } -> join a network via invite
DELETE /networks/:id/members/:key  remove a member (owner/admin)
```

## Testing

```bash
npm test          # unit + integration (49 tests)
npm run typecheck # tsc across all packages
```

The integration suite (`packages/node/test/integration.test.ts`) spins up three
real libp2p nodes with in-memory databases and asserts they converge on the same
topic snapshot — including third-node propagation via peer discovery. The
anonymous-mode suite (`packages/node/test/tor.test.ts`) asserts that a Tor node
announces only `.onion` addresses and refuses clearnet peers.

## Security notes (MVP scope)

- **Private keys are stored in plaintext** in the SQLite `identity` table.
  Encrypting the keystore (as the original did with a password) is a planned
  follow-up; the schema already isolates the secret.
- The daemon binds to loopback by default and now supports an optional bearer
  token (`--token`). Always set it before exposing the API on a non-loopback
  interface.
- In `--tor` mode no clearnet address is dialed or announced. Note that Tor
  hides your IP but does not hide that you use Tor from your ISP (unless you
  use bridges), and the stable author key still links all of a user's posts.
- Received content is verified (content address + Ed25519 signature) before it is
  stored, but it is **auto-accepted** by default (`autoAcceptReceived`). Moderation
  based on the original `status`/reputation model is a follow-up.

## Roadmap

- **Per-network unlinkable identities:** derive a distinct author subkey per
  network (HKDF) so the same person is not linkable across communities.
- **Encrypted networks (Fase B):** per-epoch group keys (XChaCha20-Poly1305),
  wrapped per member via Ed25519→X25519 ECDH, rotated on add/remove — so a
  removed member cannot read *future* posts.
- **Mobile node on-device:** run the full node inside the Capacitor app
  (embedded Node runtime or WASM SQLite + browser libp2p transports) and route it
  through Tor (Orbot). The desktop app and the mobile shell already exist — see
  [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md).
- Kademlia DHT + AutoNAT + Circuit Relay v2 + DCUtR, so invites and sync work
  across NATs without a manually shared address or port forwarding.
- GossipSub push for sub-second propagation instead of periodic pull.
- Camera QR **scanning** in the web UI (currently the QR is generated for others
  to read; joining is by pasting the code).
- Encrypted keystore + key import/export.
- Moderation UI backed by article `status` and peer reputation.
- Labels as votes (the original's static + node label split).

## License

O PeerForum é **software livre e de código aberto**. Este repositório é uma
reimplementação inspirada no projeto original
[saintthor/PeerForum](https://github.com/saintthor/PeerForum).

> ⚠️ **TODO:** escolha e adicione um arquivo `LICENSE` (ex.: MIT, Apache-2.0 ou
> GPL-3.0) antes de distribuir, para deixar os termos de uso explícitos.


