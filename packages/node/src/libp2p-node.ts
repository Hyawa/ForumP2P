/**
 * libp2p composition.
 *
 * The node key is derived deterministically from the 32-byte seed stored in
 * the core identity table, so the libp2p PeerID is stable across restarts.
 * Transport security is Noise; peers are authenticated by their PeerID, which
 * is why PFP v2 no longer needs per-message encryption or node signatures.
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

export interface CreateNodeParams {
  /** 32-byte Ed25519 seed, hex encoded. */
  seedHex: string;
  listen: string[];
  bootstrap: string[];
  enableMdns: boolean;
}

export async function createPfpLibp2p(params: CreateNodeParams) {
  const privateKey = await generateKeyPairFromSeed('Ed25519', hexToBytes(params.seedHex));

  return createLibp2p({
    privateKey,
    addresses: { listen: params.listen },
    transports: [tcp(), webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      ...(params.bootstrap.length > 0 ? [bootstrap({ list: params.bootstrap })] : []),
      ...(params.enableMdns ? [mdns()] : []),
    ],
    services: { identify: identify() },
  });
}

export type PfpLibp2p = Awaited<ReturnType<typeof createPfpLibp2p>>;
