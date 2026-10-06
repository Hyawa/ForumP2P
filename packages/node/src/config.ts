/**
 * Runtime configuration for a PFP node. These are the modern equivalents of the
 * network-tuning constants in the original `const.py` (sync cycles, peer
 * counts, time windows).
 */
export interface PFPNodeConfig {
  /** SQLite file, or ':memory:'. */
  dbPath: string;
  /** libp2p listen multiaddrs. */
  listen: string[];
  /** Bootstrap peers as full multiaddrs (optionally with /p2p/<peerId>). */
  bootstrap: string[];
  /** Enable local-network discovery via mDNS. */
  enableMdns: boolean;
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
  autoSync: true,
  syncIntervalMs: 15_000,
  rpcTimeoutMs: 10_000,
  peerBatchSize: 5,
  autoAcceptReceived: true,
};
