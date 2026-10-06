/**
 * libp2p composition.
 *
 * The node key is derived deterministically from the 32-byte seed stored in
 * the core identity table, so the libp2p PeerID is stable across restarts.
 * Transport security is Noise; peers are authenticated by their PeerID, which
 * is why PFP v2 no longer needs per-message encryption or node signatures.
 *
 * In Tor mode all dialing goes through a local SOCKS5 proxy, only onion
 * multiaddrs are announced, and clearnet discovery (mDNS/bootstrap) is disabled
 * so a peer never learns another peer's IP.
 */
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { identify } from '@libp2p/identify';
import { mdns } from '@libp2p/mdns';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { hexToBytes } from '@pforum/protocol';
import { createLibp2p } from 'libp2p';

import { isOnionMultiaddr, torDialer } from './transports/tor';

export interface CreateNodeParams {
  /** 32-byte Ed25519 seed, hex encoded. */
  seedHex: string;
  listen: string[];
  bootstrap: string[];
  enableMdns: boolean;
  /** When set, dial through Tor and announce only these onion multiaddrs. */
  tor?: { socksHost: string; socksPort: number; announce: string[] } | null;
}

export async function createPfpLibp2p(params: CreateNodeParams) {
  const privateKey = await generateKeyPairFromSeed('Ed25519', hexToBytes(params.seedHex));
  const tor = params.tor ?? null;
  const torEnabled = tor !== null;

  const announce = tor?.announce ?? [];
  const transportFactories = torEnabled
    ? [tcp(), torDialer({ socksHost: tor.socksHost, socksPort: tor.socksPort })]
    : [tcp(), webSockets()];

  return createLibp2p({
    privateKey,
    addresses: {
      listen: params.listen,
      // Announcing explicit onion addrs suppresses the loopback listen addrs.
      ...(torEnabled ? { announce } : {}),
      // Even observed/identify addresses must never leak a clearnet IP.
      ...(torEnabled
        ? { announceFilter: (addrs: import('@multiformats/multiaddr').Multiaddr[]) => addrs.filter(isOnionMultiaddr) }
        : {}),
    },
    transports: transportFactories,
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: torEnabled
      ? []
      : [
          ...(params.bootstrap.length > 0 ? [bootstrap({ list: params.bootstrap })] : []),
          ...(params.enableMdns ? [mdns()] : []),
        ],
    services: { identify: identify() },
  });
}

export type PfpLibp2p = Awaited<ReturnType<typeof createPfpLibp2p>>;

