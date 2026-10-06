/**
 * Zod schemas for every object that crosses a trust boundary.
 *
 * Inbound data from peers / the local HTTP API is parsed through these before
 * it touches the database or the sync engine.
 */
import { z } from 'zod';

import { LIMITS } from './constants';

export const Hex32 = z.string().regex(/^[0-9a-f]{64}$/, 'expected 32-byte hex');
export const Hex64 = z.string().regex(/^[0-9a-f]{128}$/, 'expected 64-byte hex');

export const PublicKeySchema = Hex32;
export const SignatureSchema = Hex64;
export const ArticleIdSchema = Hex32;

const LabelSchema = z.string().min(1).max(LIMITS.MAX_LABEL_LEN);

/**
 * The part of an article that is hashed and signed. Field order does not
 * matter on the wire (canonicalization sorts keys) but the set of fields must
 * be stable forever: changing it changes every article ID.
 */
export const ArticlePayloadSchema = z.object({
  /** Payload format version. */
  v: z.literal(2),
  /** Article kind (0 normal, 1 like, 2 chat). */
  type: z.number().int().min(0).max(2),
  /** UTF-8 body. Empty is allowed for structural articles. */
  content: z.string().max(LIMITS.CONTENT_BYTES),
  /** Root article id of the topic, or null for a root article. */
  rootId: ArticleIdSchema.nullable(),
  /** Parent article id within the topic, or null for a root article. */
  parentId: ArticleIdSchema.nullable(),
  /** Author-declared labels (only meaningful on roots). */
  labels: z.array(LabelSchema).max(LIMITS.MAX_LABELS),
  /** Wall-clock creation time, ms since epoch. */
  createTime: z.number().int().nonnegative(),
  /** Optional expiry, ms since epoch. Ephemeral posts. */
  destroyTime: z.number().int().nonnegative().nullable(),
  /** Author's Ed25519 public key (hex). */
  author: PublicKeySchema,
});

export const SignedArticleSchema = ArticlePayloadSchema.extend({
  /** sha256(canonical(payload)) hex. */
  id: ArticleIdSchema,
  /** Ed25519 signature over canonical(payload), hex. */
  signature: SignatureSchema,
});

export const TopicHeadSchema = z.object({
  topicId: ArticleIdSchema,
  title: z.string().max(LIMITS.MAX_TITLE_LEN),
  labels: z.array(LabelSchema),
  count: z.number().int().nonnegative(),
  lastTime: z.number().int().nonnegative(),
  snapshot: Hex32,
});

// --- networks ---------------------------------------------------------------

export const NetworkIdSchema = Hex32;
export const NetworkRoleSchema = z.enum(['owner', 'admin', 'member']);
export const RosterOpTypeSchema = z.enum(['create', 'add', 'remove', 'setRole']);

export const NetworkInfoSchema = z.object({
  networkId: NetworkIdSchema,
  name: z.string().min(1).max(LIMITS.MAX_NETWORK_NAME_LEN),
  owner: PublicKeySchema,
  salt: Hex32,
  createdAt: z.number().int().nonnegative(),
});

/**
 * A single, signed, immutable entry in a network's membership log. Ops form a
 * hash chain via `prevHash`, giving every member an auditable history.
 */
export const RosterOpSchema = z.object({
  networkId: NetworkIdSchema,
  opType: RosterOpTypeSchema,
  /** The user the op acts on (for `create`, the owner). */
  subject: PublicKeySchema,
  /** Role to grant for `add`/`setRole`. */
  role: NetworkRoleSchema.nullable(),
  /** Monotonic counter, incremented by add/remove ops. */
  epoch: z.number().int().nonnegative(),
  /** Signer: the owner or an admin. */
  author: PublicKeySchema,
  prevHash: Hex32.nullable(),
  createdAt: z.number().int().nonnegative(),
  opId: Hex32,
  signature: SignatureSchema,
});

/** The signed binding between a node's PeerID and the user it acts for. */
export const HelloBindingSchema = z.object({
  user: PublicKeySchema,
  peerId: z.string().min(1).max(128),
  /** Dialable multiaddrs so the remote can reach us back. */
  addrs: z.array(z.string().min(1).max(512)).max(LIMITS.MAX_PEERS_SHARED).default([]),
  signature: SignatureSchema,
});

/** The payload of an invite code (before encoding to text/QR). */
export const InviteCodeSchema = z.object({
  v: z.literal(2),
  networkId: NetworkIdSchema,
  secret: Hex32,
  inviter: PublicKeySchema,
  addrs: z.array(z.string().min(1).max(512)).max(LIMITS.MAX_PEERS_SHARED),
  expiresAt: z.number().int().nonnegative(),
  maxUses: z.number().int().positive(),
  signature: SignatureSchema,
});

export const PeerInfoSchema = z.object({
  peerId: z.string().min(1).max(128),
  multiaddrs: z.array(z.string().min(1).max(512)).max(16),
});

const ErrorMessage = z.object({ type: z.literal('Error'), message: z.string().max(2048) });

// --- peers protocol ---------------------------------------------------------
export const GetPeersSchema = z.object({ type: z.literal('GetPeers') });
export const PeersSchema = z.object({
  type: z.literal('Peers'),
  peers: z.array(PeerInfoSchema).max(LIMITS.MAX_PEERS_SHARED),
});

// --- hello protocol ---------------------------------------------------------
export const HelloSchema = HelloBindingSchema.extend({ type: z.literal('Hello') });
export const HelloAckSchema = HelloBindingSchema.extend({ type: z.literal('HelloAck') });

// --- networks protocol ------------------------------------------------------
export const GetRosterSchema = z.object({
  type: z.literal('GetRoster'),
  networkId: NetworkIdSchema,
});
export const RosterSchema = z.object({
  type: z.literal('Roster'),
  network: NetworkInfoSchema,
  ops: z.array(RosterOpSchema).max(LIMITS.MAX_ROSTER_OPS),
});
export const JoinRequestSchema = z.object({
  type: z.literal('JoinRequest'),
  invite: InviteCodeSchema,
  hello: HelloBindingSchema,
});
export const JoinAcceptedSchema = z.object({
  type: z.literal('JoinAccepted'),
  network: NetworkInfoSchema,
  ops: z.array(RosterOpSchema).max(LIMITS.MAX_ROSTER_OPS),
});
export const PushOpsSchema = z.object({
  type: z.literal('PushOps'),
  networkId: NetworkIdSchema,
  ops: z.array(RosterOpSchema).max(LIMITS.MAX_ROSTER_OPS),
});

// --- sync protocol ----------------------------------------------------------
export const GetTopicHeadsSchema = z.object({
  type: z.literal('GetTopicHeads'),
  since: z.number().int().nonnegative().nullable(),
  until: z.number().int().nonnegative().nullable(),
  /** null = the node's public/local topics, otherwise a network's topics. */
  networkId: NetworkIdSchema.nullable().default(null),
});
export const TopicHeadsSchema = z.object({
  type: z.literal('TopicHeads'),
  heads: z.array(TopicHeadSchema).max(LIMITS.MAX_TOPIC_HEADS),
});
export const GetPostsSchema = z.object({
  type: z.literal('GetPosts'),
  topicId: ArticleIdSchema,
  /** Leaf article ids the requester already has, for set reconciliation. */
  have: z.array(ArticleIdSchema).max(100_000),
  networkId: NetworkIdSchema.nullable().default(null),
});
export const PostsSchema = z.object({
  type: z.literal('Posts'),
  articles: z.array(SignedArticleSchema).max(100_000),
});

// --- timeline protocol ------------------------------------------------------
export const GetUserPostsSchema = z.object({
  type: z.literal('GetUserPosts'),
  author: PublicKeySchema,
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});

export const MessageSchema = z.discriminatedUnion('type', [
  ErrorMessage,
  GetPeersSchema,
  PeersSchema,
  HelloSchema,
  HelloAckSchema,
  GetRosterSchema,
  RosterSchema,
  JoinRequestSchema,
  JoinAcceptedSchema,
  PushOpsSchema,
  GetTopicHeadsSchema,
  TopicHeadsSchema,
  GetPostsSchema,
  PostsSchema,
  GetUserPostsSchema,
]);

/** Every frame on the wire is an envelope with a version and a timestamp. */
export const EnvelopeSchema = z.object({
  p: z.literal('PFP/2.0'),
  t: z.number().int().nonnegative(),
  m: MessageSchema,
});

export type Envelope = z.infer<typeof EnvelopeSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type PeerInfo = z.infer<typeof PeerInfoSchema>;
export type TopicHead = z.infer<typeof TopicHeadSchema>;
export type SignedArticleInput = z.input<typeof SignedArticleSchema>;
export type NetworkInfo = z.infer<typeof NetworkInfoSchema>;
export type RosterOp = z.infer<typeof RosterOpSchema>;
export type InviteCode = z.infer<typeof InviteCodeSchema>;
export type HelloBinding = z.infer<typeof HelloBindingSchema>;
