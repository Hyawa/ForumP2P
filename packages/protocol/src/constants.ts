/**
 * PFP v2 protocol constants.
 *
 * These are the modern equivalents of the `const.py` values from the original
 * PeerForum (2015). Network tuning knobs that are deployment-specific
 * (sync intervals, peer counts) live in the node package, not here.
 */

/** Wire protocol version, carried in every envelope. */
export const PFP_VERSION = 'PFP/2.0';

/** libp2p protocol IDs. Each maps to a stream handler on the remote peer. */
export const PFP_PROTOCOLS = {
  /** Topic head exchange + set reconciliation + post transfer. */
  sync: '/pforum/sync/1.0.0',
  /** Peer discovery / gossip of known friends. */
  peers: '/pforum/peers/1.0.0',
  /** Follow a user's posts within a time window. */
  timeline: '/pforum/timeline/1.0.0',
  /** Exchange the signed binding between a node's PeerID and its user key. */
  hello: '/pforum/hello/1.0.0',
  /** Network rosters: join requests, roster sync, membership ops. */
  networks: '/pforum/networks/1.0.0',
} as const;

export type PFPProtocol = (typeof PFP_PROTOCOLS)[keyof typeof PFP_PROTOCOLS];

/** Article kinds. LIKE/CHAT are reserved for post-MVP. */
export const ARTICLE_TYPE = {
  NORMAL: 0,
  LIKE: 1,
  CHAT: 2,
} as const;

export type ArticleType = (typeof ARTICLE_TYPE)[keyof typeof ARTICLE_TYPE];

/**
 * Local moderation status of an article. Mirrors the original PeerForum
 * semantics: peers upgrade/downgrade the reputation of the node that supplied
 * the content based on how the user rates it.
 */
export const ARTICLE_STATUS = {
  BLOCK: -1,
  RECEIVE: 0,
  PASS: 1,
  GOOD: 2,
} as const;

export type ArticleStatus = (typeof ARTICLE_STATUS)[keyof typeof ARTICLE_STATUS];

/** Shared validation regexes for 64-char hex identifiers. */
export const ARTICLE_ID_REGEX = /^[0-9a-f]{64}$/;
export const PUBLIC_KEY_REGEX = /^[0-9a-f]{64}$/;

/** Roles within a network. The owner is the root authority. */
export const NETWORK_ROLE = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

export type NetworkRole = (typeof NETWORK_ROLE)[keyof typeof NETWORK_ROLE];

/** Membership operations, appended to a network's signed roster log. */
export const ROSTER_OP = {
  CREATE: 'create',
  ADD: 'add',
  REMOVE: 'remove',
  SET_ROLE: 'setRole',
} as const;

export type RosterOpType = (typeof ROSTER_OP)[keyof typeof ROSTER_OP];

/** Invite code format and defaults. */
export const INVITE = {
  /** Scheme shown in the human-readable help text. */
  SCHEME: 'pforum',
  /** Prefix on the base64url payload so codes are recognizable. */
  PREFIX: 'PFPJOIN1.',
  /** Default lifetime of an invite. */
  DEFAULT_TTL_MS: 24 * 60 * 60 * 1000,
  /** Default number of successful joins allowed per invite. */
  DEFAULT_MAX_USES: 1,
  /** Maximum bootstrap multiaddrs embedded in a single invite. */
  MAX_ADDRS: 8,
} as const;

/** Reputation bounds for a peer, mirroring the original `level` (default 20). */
export const PEER_LEVEL = {
  MIN: 1,
  MAX: 99,
  DEFAULT: 20,
} as const;

/** Limits. Keep them conservative: this is a hostile input surface. */
export const LIMITS = {
  /** Max bytes of an article's text content. */
  CONTENT_BYTES: 64 * 1024,
  /** Max bytes for a single wire message (defensive, per frame). */
  MESSAGE_BYTES: 8 * 1024 * 1024,
  MAX_LABELS: 8,
  MAX_LABEL_LEN: 32,
  MAX_TITLE_LEN: 80,
  /** Number of topic heads offered per sync round. */
  MAX_TOPIC_HEADS: 100,
  /** Number of peers shared in a single Peers response. */
  MAX_PEERS_SHARED: 30,
  /** Maximum messages processed per stream before we stop (anti-DoS). */
  MAX_MESSAGES_PER_STREAM: 64,
  /** Max bytes of a network name. */
  MAX_NETWORK_NAME_LEN: 48,
  /** Max roster ops returned / accepted in one message. */
  MAX_ROSTER_OPS: 4096,
} as const;
