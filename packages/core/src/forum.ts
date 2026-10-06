/**
 * The Forum service: the high-level, transport-agnostic API over the store.
 *
 * It owns the local user identity and turns peer-supplied data into verified,
 * stored articles, and turns local state into the payloads the sync protocol
 * needs. It also manages networks: their rosters (signed membership logs),
 * invites, and the authorization rules that govern them.
 */
import { EventEmitter } from 'node:events';

import {
  ARTICLE_STATUS,
  INVITE,
  NETWORK_ROLE,
  bytesToHex,
  contentId,
  createArticle,
  encodeInviteCode,
  foldRoster,
  isActiveMember,
  roleOf,
  signInvite,
  signRosterOp,
  verifyArticle,
  verifyInvite,
  verifyRosterOp,
  type CreateArticleInput,
  type InviteCode,
  type MemberState,
  type NetworkInfo,
  type NetworkRole,
  type RosterOp,
  type RosterState,
  type SignedArticle,
  type TopicHead,
} from '@pforum/protocol';

import { openDatabase, type SqlDatabase } from './db';
import { IdentityManager, type Identity } from './identity';
import { reconcile } from './reconcile';
import { ForumStore, type InviteRecord, type PeerRecord, type TopicRecord } from './store';

export interface ForumOptions {
  /** SQLite path, or ':memory:' for ephemeral nodes/tests. */
  dbPath: string;
  /** Accepting incoming content by default keeps the MVP gossip-able. */
  autoAcceptReceived?: boolean;
}

export type IngestStatus = 'stored' | 'duplicate' | 'invalid';

export interface IngestResult {
  status: IngestStatus;
  error?: string;
}

export interface NetworkSummary extends NetworkInfo {
  myRole: NetworkRole | null;
  memberCount: number;
}

export interface NetworkView {
  network: NetworkInfo;
  myRole: NetworkRole | null;
  members: MemberState[];
}

export interface CreateInviteOptions {
  expiresInMs?: number;
  maxUses?: number;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return bytesToHex(buffer);
}

function computeNetworkId(owner: string, name: string, salt: string): string {
  return contentId({ t: 'pforum-network@2', owner, name, salt });
}

export class Forum {
  private readonly store: ForumStore;
  private readonly nodeIdentityManager: IdentityManager;
  /** Long-lived emitter so the daemon can stream live events (SSE). */
  readonly events = new EventEmitter();

  private constructor(
    private readonly db: SqlDatabase,
    private readonly user: Identity,
    private readonly autoAcceptReceived: boolean,
  ) {
    this.store = new ForumStore(db);
    this.nodeIdentityManager = new IdentityManager(db, 'node');
  }

  static async open(options: ForumOptions): Promise<Forum> {
    const db = openDatabase(options.dbPath);
    const identityManager = new IdentityManager(db, 'user');
    const user = await identityManager.ensure();
    return new Forum(db, user, options.autoAcceptReceived ?? true);
  }

  close(): void {
    this.db.close();
  }

  get identity(): Identity {
    return this.user;
  }

  /**
   * The node (libp2p) identity seed. Kept separate from the user identity so a
   * machine can relay content without revealing which human author is behind it.
   */
  async ensureNodeIdentity(): Promise<Identity> {
    return this.nodeIdentityManager.ensure();
  }

  get peers() {
    return {
      list: (options?: { exclude?: string; limit?: number }): PeerRecord[] =>
        this.store.listPeers(options),
      get: (peerId: string): PeerRecord | undefined => this.store.getPeer(peerId),
      upsert: (peerId: string, multiaddrs?: string[]): void =>
        this.store.upsertPeer(peerId, multiaddrs),
      touch: (peerId: string, timestamp?: number): void => this.store.touchPeer(peerId, timestamp),
      adjustLevel: (peerId: string, delta: number): void =>
        this.store.adjustPeerLevel(peerId, delta),
      recordFail: (peerId: string): void => this.store.recordPeerFail(peerId),
    };
  }

  // --- networks -------------------------------------------------------------

  /** Creates a network; the creator becomes its owner via the `create` op. */
  async createNetwork(name: string): Promise<NetworkInfo> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('network name is required');
    const salt = randomHex(32);
    const info: NetworkInfo = {
      networkId: computeNetworkId(this.user.publicKey, trimmed, salt),
      name: trimmed,
      owner: this.user.publicKey,
      salt,
      createdAt: Date.now(),
    };
    this.store.insertNetwork(info);
    const op = await signRosterOp(
      {
        networkId: info.networkId,
        opType: 'create',
        subject: this.user.publicKey,
        role: NETWORK_ROLE.OWNER,
        epoch: 0,
        author: this.user.publicKey,
        prevHash: null,
        createdAt: info.createdAt,
      },
      this.user.privateKey,
    );
    this.store.appendRosterOp(op);
    this.events.emit('roster', { networkId: info.networkId });
    return info;
  }

  getNetwork(networkId: string): NetworkInfo | undefined {
    return this.store.getNetwork(networkId);
  }

  /** Stores network metadata received from a peer (e.g. after joining). */
  rememberNetwork(info: NetworkInfo): void {
    this.store.insertNetwork(info);
  }

  listNetworks(): NetworkSummary[] {
    return this.store.listNetworks().map((info) => {
      const state = this.rosterState(info.networkId);
      return {
        ...info,
        myRole: roleOf(state, this.user.publicKey),
        memberCount: [...state.members.values()].filter((member) => member.active).length,
      };
    });
  }

  getNetworkView(networkId: string): NetworkView | undefined {
    const info = this.store.getNetwork(networkId);
    if (!info) return undefined;
    const state = this.rosterState(networkId);
    return {
      network: info,
      myRole: roleOf(state, this.user.publicKey),
      members: [...state.members.values()],
    };
  }

  rosterOps(networkId: string): RosterOp[] {
    return this.store.getRosterOps(networkId);
  }

  rosterState(networkId: string): RosterState {
    return foldRoster(this.store.getRosterOps(networkId));
  }

  membership(networkId: string, user: string): MemberState | undefined {
    return this.rosterState(networkId).members.get(user);
  }

  isMember(networkId: string, user: string): boolean {
    return isActiveMember(this.rosterState(networkId), user);
  }

  #assertAuthority(networkId: string, level: NetworkRole): void {
    const info = this.store.getNetwork(networkId);
    if (!info) throw new Error('unknown network');
    const role = roleOf(this.rosterState(networkId), this.user.publicKey);
    if (level === NETWORK_ROLE.OWNER) {
      if (role !== NETWORK_ROLE.OWNER) throw new Error('only the owner can do this');
      return;
    }
    if (role !== NETWORK_ROLE.OWNER && role !== NETWORK_ROLE.ADMIN) {
      throw new Error('requires owner or admin');
    }
  }

  #nextOpContext(networkId: string): { epoch: number; prevHash: string | null } {
    const ops = this.store.getRosterOps(networkId);
    const epoch = ops.reduce((max, op) => Math.max(max, op.epoch), -1) + 1;
    const prevHash = ops.length > 0 ? ops[ops.length - 1]!.opId : null;
    return { epoch, prevHash };
  }

  async addMember(
    networkId: string,
    subject: string,
    role: NetworkRole = NETWORK_ROLE.MEMBER,
  ): Promise<RosterOp> {
    this.#assertAuthority(networkId, NETWORK_ROLE.ADMIN);
    const { epoch, prevHash } = this.#nextOpContext(networkId);
    const op = await signRosterOp(
      {
        networkId,
        opType: 'add',
        subject,
        role,
        epoch,
        author: this.user.publicKey,
        prevHash,
        createdAt: Date.now(),
      },
      this.user.privateKey,
    );
    this.store.appendRosterOp(op);
    this.events.emit('roster', { networkId });
    return op;
  }

  async removeMember(networkId: string, subject: string): Promise<RosterOp> {
    this.#assertAuthority(networkId, NETWORK_ROLE.ADMIN);
    if (subject === this.user.publicKey) throw new Error('the owner cannot remove themselves');
    const { epoch, prevHash } = this.#nextOpContext(networkId);
    const op = await signRosterOp(
      {
        networkId,
        opType: 'remove',
        subject,
        role: null,
        epoch,
        author: this.user.publicKey,
        prevHash,
        createdAt: Date.now(),
      },
      this.user.privateKey,
    );
    this.store.appendRosterOp(op);
    this.events.emit('roster', { networkId });
    return op;
  }

  async setRole(networkId: string, subject: string, role: NetworkRole): Promise<RosterOp> {
    this.#assertAuthority(networkId, NETWORK_ROLE.OWNER);
    const { epoch, prevHash } = this.#nextOpContext(networkId);
    const op = await signRosterOp(
      {
        networkId,
        opType: 'setRole',
        subject,
        role,
        epoch,
        author: this.user.publicKey,
        prevHash,
        createdAt: Date.now(),
      },
      this.user.privateKey,
    );
    this.store.appendRosterOp(op);
    this.events.emit('roster', { networkId });
    return op;
  }

  /** Verifies and stores roster ops received from peers. */
  async applyRosterOps(networkId: string, ops: RosterOp[]): Promise<number> {
    let applied = 0;
    for (const op of ops) {
      if (op.networkId !== networkId) continue;
      if (this.store.hasRosterOp(op.opId)) continue;
      if (!(await verifyRosterOp(op))) continue;
      if (this.store.appendRosterOp(op)) applied += 1;
    }
    if (applied > 0) this.events.emit('roster', { networkId });
    return applied;
  }

  async createInvite(
    networkId: string,
    options: CreateInviteOptions,
    addrs: string[],
  ): Promise<{ invite: InviteCode; code: string }> {
    this.#assertAuthority(networkId, NETWORK_ROLE.ADMIN);
    const secret = randomHex(32);
    const maxUses = options.maxUses ?? INVITE.DEFAULT_MAX_USES;
    const expiresAt = Date.now() + (options.expiresInMs ?? INVITE.DEFAULT_TTL_MS);
    const record: InviteRecord = {
      secret,
      networkId,
      inviter: this.user.publicKey,
      expiresAt,
      maxUses,
      usedCount: 0,
      revoked: false,
      createdAt: Date.now(),
    };
    this.store.insertInvite(record);
    const invite = await signInvite(
      {
        networkId,
        secret,
        inviter: this.user.publicKey,
        addrs: addrs.slice(0, INVITE.MAX_ADDRS),
        expiresAt,
        maxUses,
      },
      this.user.privateKey,
    );
    return { invite, code: encodeInviteCode(invite) };
  }

  /**
   * Validates an invite and, if the local user has authority, signs an `add`
   * op admitting the applicant. Idempotent: an existing active member gets the
   * roster back without consuming the invite.
   */
  async acceptJoin(
    invite: InviteCode,
    applicantUser: string,
  ): Promise<{ network: NetworkInfo; ops: RosterOp[] }> {
    const info = this.store.getNetwork(invite.networkId);
    if (!info) throw new Error('unknown network');
    this.#assertAuthority(invite.networkId, NETWORK_ROLE.ADMIN);
    if (!(await verifyInvite(invite))) throw new Error('invalid invite signature');

    const record = this.store.getInvite(invite.secret);
    if (!record) throw new Error('invite not recognized');
    if (record.networkId !== invite.networkId) throw new Error('invite/network mismatch');
    if (record.revoked) throw new Error('invite revoked');
    if (record.expiresAt < Date.now()) throw new Error('invite expired');
    if (record.usedCount >= record.maxUses) throw new Error('invite already used');

    const state = this.rosterState(invite.networkId);
    const existing = state.members.get(applicantUser);
    if (!(existing && existing.active)) {
      await this.addMember(invite.networkId, applicantUser, NETWORK_ROLE.MEMBER);
      this.store.consumeInvite(invite.secret);
    }

    return { network: info, ops: this.store.getRosterOps(invite.networkId) };
  }

  // --- writing --------------------------------------------------------------

  /** Creates, signs and stores an article authored by the local user. */
  async post(input: CreateArticleInput, networkId: string | null = null): Promise<SignedArticle> {
    if (networkId !== null && !this.isMember(networkId, this.user.publicKey)) {
      throw new Error('not a member of this network');
    }
    const article = await createArticle(input, this.user.publicKey, this.user.privateKey);
    this.store.saveArticle(article, { status: ARTICLE_STATUS.PASS, networkId });
    this.store.refreshTopic(article.rootId ?? article.id);
    this.events.emit('article', article);
    return article;
  }

  /**
   * Verifies and stores an article received from a peer (or the local API).
   * Verification is mandatory: content and authorship are untrusted until the
   * signature and content address check out.
   */
  async ingest(
    candidate: unknown,
    fromPeer: string | null = null,
    networkId: string | null = null,
  ): Promise<IngestResult> {
    const result = await verifyArticle(candidate);
    if (!result.ok) return { status: 'invalid', error: result.error };
    const article = candidate as SignedArticle;
    if (networkId !== null && !this.isMember(networkId, article.author)) {
      return { status: 'invalid', error: 'author is not a member of this network' };
    }
    return this.#storeVerified(article, fromPeer, networkId);
  }

  #storeVerified(
    article: SignedArticle,
    fromPeer: string | null,
    networkId: string | null,
  ): IngestResult {
    const status = this.autoAcceptReceived ? ARTICLE_STATUS.PASS : ARTICLE_STATUS.RECEIVE;
    const inserted = this.store.saveArticle(article, { status, fromPeer, networkId });
    if (!inserted) return { status: 'duplicate' };
    this.store.refreshTopic(article.rootId ?? article.id);
    this.events.emit('article', article);
    return { status: 'stored' };
  }

  // --- reading --------------------------------------------------------------

  listTopics(options?: {
    limit?: number;
    label?: string;
    before?: number;
    networkId?: string | null;
  }): TopicRecord[] {
    return this.store.listTopics(options);
  }

  getTopic(topicId: string): TopicRecord | undefined {
    return this.store.getTopic(topicId);
  }

  getTopicTree(topicId: string): SignedArticle[] {
    return this.store.getArticlesByRoot(topicId, true);
  }

  listTopicHeads(
    since: number | null,
    until: number | null,
    networkId: string | null = null,
  ): TopicHead[] {
    return this.store.listTopicHeads(since, until, networkId);
  }

  topicLeaves(topicId: string): string[] {
    return this.store.getTopicLeaves(topicId, true);
  }

  userPosts(author: string, from: number, to: number): SignedArticle[] {
    return this.store.getArticlesByAuthor(author, from, to);
  }

  getArticle(id: string): SignedArticle | undefined {
    return this.store.getArticle(id);
  }

  // --- sync helpers ---------------------------------------------------------

  /**
   * Returns the articles needed to bring a peer up to date, given the leaf ids
   * that peer advertised. This is the serve side of reconciliation.
   */
  postsToSend(topicId: string, remoteLeaves: string[]): SignedArticle[] {
    const graph = this.store.getTopicGraph(topicId, true);
    if (graph.size === 0) return [];
    const { toSend } = reconcile(graph, remoteLeaves);
    return this.store.getArticlesByIds(toSend);
  }

  /**
   * Verifies and stores a batch of articles received during sync. Invalid
   * articles, and (within a network) those authored by non-members, are skipped.
   */
  async ingestBatch(
    articles: SignedArticle[],
    fromPeer: string | null,
    networkId: string | null = null,
  ): Promise<{ stored: number; skipped: number }> {
    const state = networkId !== null ? this.rosterState(networkId) : null;
    let stored = 0;
    let skipped = 0;
    for (const article of articles) {
      const result = await verifyArticle(article);
      if (!result.ok) {
        skipped += 1;
        continue;
      }
      if (state && !isActiveMember(state, article.author)) {
        skipped += 1;
        continue;
      }
      const storedResult = this.#storeVerified(article, fromPeer, networkId);
      if (storedResult.status === 'stored') stored += 1;
      else skipped += 1;
    }
    return { stored, skipped };
  }
}

export type { Identity } from './identity';
export type { TopicRecord, PeerRecord, InviteRecord } from './store';
