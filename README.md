# PeerForum (PFP v2)

A modern, serverless, peer-to-peer forum. This is a clean TypeScript rewrite of
[saintthor/PeerForum](https://github.com/saintthor/PeerForum) (a 2015 Python 2
project, "a p2p forum with no server needed"), keeping its core ideas —
**decentralized keypair identity**, **content-addressed signed posts**, and
**set-reconciliation sync over a gossip network** — while replacing the
hand-rolled crypto and HTTP polling with modern primitives.

PeerForum P2P v2 tem que ser um grupo fechado, anonimo e totalmente descentralizado onde ninguem sabe quem é quem. Detalhe ele pode ser usado para criar qualquer tipo de comunidade totalmente anonima e descentralizada. Imagina uma comunidade onde pessoas querem se reunir para falar sobre carros, eles criam um fork do PeerForum, enviam os convites de uma pessoa para outra e controla quem entra quem sai como se fosse um grupo privado no whatsapp só que tem servidor central e totalmente P2P e esse grupo pode ter quantos membros quiser

> Status: MVP. Identity, signed posts, topics-as-trees, peer discovery and P2P
> synchronization work end to end. Moderation, labels-as-votes and search are
> follow-ups.

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
npm test          # unit + integration (28 tests)
npm run typecheck # tsc across all packages
```

The integration suite (`packages/node/test/integration.test.ts`) spins up three
real libp2p nodes with in-memory databases and asserts they converge on the same
topic snapshot — including third-node propagation via peer discovery.

## Security notes (MVP scope)

- **Private keys are stored in plaintext** in the SQLite `identity` table.
  Encrypting the keystore (as the original did with a password) is a planned
  follow-up; the schema already isolates the secret.
- The daemon has **no auth token**; it is safe only because it binds to loopback.
  Add a bearer token before exposing it on a non-loopback interface.
- Received content is verified (content address + Ed25519 signature) before it is
  stored, but it is **auto-accepted** by default (`autoAcceptReceived`). Moderation
  based on the original `status`/reputation model is a follow-up.

## Roadmap

- **Encrypted networks (Fase B):** per-epoch group keys (XChaCha20-Poly1305),
  wrapped per member via Ed25519→X25519 ECDH, rotated on add/remove — so a
  removed member cannot read *future* posts.
- Kademlia DHT + AutoNAT + Circuit Relay v2 + DCUtR, so invites and sync work
  across NATs without a manually shared address or port forwarding.
- GossipSub push for sub-second propagation instead of periodic pull.
- Camera QR **scanning** in the web UI (currently the QR is generated for others
  to read; joining is by pasting the code).
- Encrypted keystore + key import/export.
- Moderation UI backed by article `status` and peer reputation.
- Labels as votes (the original's static + node label split).

## License

This is a reimplementation inspired by the original PeerForum project. Add the
license you intend to use before distributing.


