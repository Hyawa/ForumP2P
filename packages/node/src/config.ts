/**
 * Runtime configuration for a PFP node. These are the modern equivalents of the
 * network-tuning constants in the original `const.py` (sync cycles, peer
 * counts, time windows).
 */

/**
 * Anonymous ("Tor") mode. When set, the node dials peers only through a local
 * Tor SOCKS5 proxy, announces only `.onion` multiaddrs and disables every
 * clearnet discovery mechanism (mDNS/bootstrap). Inbound connections are
 * expected to arrive through a Tor HiddenService that forwards to the local
 * libp2p TCP listener.
 */
export interface TorConfig {
  /** Local Tor SOCKS5 proxy host. */
  socksHost: string;
  /** Local Tor SOCKS5 proxy port. */
  socksPort: number;
  /** Onion multiaddrs to announce, e.g. `/onion3/<id>/tcp/80`. */
  announce: string[];
}

export interface PFPNodeConfig {
  /** SQLite file, or ':memory:'. */
  dbPath: string;
  /** libp2p listen multiaddrs. */
  listen: string[];
  /** Bootstrap peers as full multiaddrs (optionally with /p2p/<peerId>). */
  bootstrap: string[];
  /** Enable local-network discovery via mDNS. */
  enableMdns: boolean;
  /** When set, route all P2P traffic through Tor and announce only onion addrs. */
  tor: TorConfig | null;
  /** Run the periodic sync loop. */
  autoSync: boolean;
  /** Milliseconds between sync rounds. */
  syncIntervalMs: number;
  /** How long a single RPC (or dial) may take. */
  rpcTimeoutMs: number;
  /** How many peers to exchange per round. */
  peerBatchSize: number;
  /** Accept incoming content by default (keeps the MVP gossip-able). */
  autoAcceptReceived: boolean;
}

export const DEFAULT_CONFIG: PFPNodeConfig = {
  dbPath: './peerforum.db',
  listen: ['/ip4/0.0.0.0/tcp/0', '/ip6/::/tcp/0'],
  bootstrap: [],
  enableMdns: true,
  tor: null,
  autoSync: true,
  syncIntervalMs: 15_000,
  rpcTimeoutMs: 10_000,
  peerBatchSize: 5,
  autoAcceptReceived: true,
};
