/**
 * Storage + domain model for articles, topics, peers, networks and rosters.
 *
 * Articles are immutable and content addressed; the `topics` table is a
 * derived index (title, counts, snapshot) recomputed whenever the underlying
 * articles change. Network membership lives in an append-only `roster_ops`
 * log; the current members are derived by folding it (see protocol `networks`).
 */
import {
  ARTICLE_STATUS,
  LIMITS,
  PEER_LEVEL,
  topicSnapshot,
  type NetworkInfo,
  type RosterOp,
  type SignedArticle,
  type TopicHead,
} from '@pforum/protocol';

import type { SqlDatabase } from './db';

export interface TopicRecord {
  rootId: string;
  title: string;
  labels: string[];
  count: number;
  status: number;
  lastTime: number;
  snapshot: string;
  networkId: string | null;
}

export interface PeerRecord {
  peerId: string;
  multiaddrs: string[];
  level: number;
  failCount: number;
  lastSeen: number;
  blocked: boolean;
}

export interface InviteRecord {
  secret: string;
  networkId: string;
  inviter: string;
  expiresAt: number;
  maxUses: number;
  usedCount: number;
  revoked: boolean;
  createdAt: number;
}

export interface SaveArticleOptions {
  status?: number;
  fromPeer?: string | null;
  receivedAt?: number;
  networkId?: string | null;
}

interface ArticleRow {
  id: string;
  root_id: string;
  parent_id: string | null;
  author: string;
  type: number;
  content: string;
  labels: string;
  signature: string;
  create_time: number;
  destroy_time: number | null;
  network_id: string | null;
}

function parseLabels(raw: unknown): string[] {
  try {
    const value = JSON.parse(String(raw));
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function rowToArticle(row: ArticleRow): SignedArticle {
  return {
    v: 2,
    type: row.type,
    content: row.content,
    rootId: row.parent_id ? row.root_id : null,
    parentId: row.parent_id,
    labels: parseLabels(row.labels),
    createTime: row.create_time,
    destroyTime: row.destroy_time,
    author: row.author,
    id: row.id,
    signature: row.signature,
  };
}

function clampLevel(level: number): number {
  return Math.max(PEER_LEVEL.MIN, Math.min(PEER_LEVEL.MAX, level));
}

export class ForumStore {
  constructor(private readonly db: SqlDatabase) {}

  // --- articles -------------------------------------------------------------

  hasArticle(id: string): boolean {
    return this.db.prepare('SELECT 1 AS x FROM articles WHERE id = ?').get(id) !== undefined;
  }

  saveArticle(article: SignedArticle, options: SaveArticleOptions = {}): boolean {
    if (this.hasArticle(article.id)) return false;
    const rootId = article.rootId ?? article.id;
    this.db
      .prepare(
        `INSERT INTO articles
           (id, root_id, parent_id, author, type, content, labels, signature,
            create_time, destroy_time, status, received_at, from_peer, network_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        article.id,
        rootId,
        article.parentId,
        article.author,
        article.type,
        article.content,
        JSON.stringify(article.labels),
        article.signature,
        article.createTime,
        article.destroyTime,
        options.status ?? ARTICLE_STATUS.RECEIVE,
        options.receivedAt ?? Date.now(),
        options.fromPeer ?? null,
        options.networkId ?? null,
      );
    return true;
  }

  getArticle(id: string): SignedArticle | undefined {
    const row = this.db
      .prepare('SELECT * FROM articles WHERE id = ?')
      .get(id) as ArticleRow | undefined;
    return row ? rowToArticle(row) : undefined;
  }

  getArticleStatus(id: string): number | undefined {
    const row = this.db.prepare('SELECT status FROM articles WHERE id = ?').get(id);
    return row ? (row.status as number) : undefined;
  }

  getArticleNetwork(id: string): string | null | undefined {
    const row = this.db.prepare('SELECT network_id FROM articles WHERE id = ?').get(id);
    if (!row) return undefined;
    return (row.network_id as string | null) ?? null;
  }

  getArticlesByIds(ids: string[]): SignedArticle[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM articles WHERE id IN (${placeholders})`)
      .all(...ids) as unknown as ArticleRow[];
    return rows.map(rowToArticle);
  }

  getArticlesByRoot(rootId: string, shareableOnly = false): SignedArticle[] {
    const where = shareableOnly ? 'AND status >= 1' : '';
    const rows = this.db
      .prepare(`SELECT * FROM articles WHERE root_id = ? ${where} ORDER BY create_time ASC, id ASC`)
      .all(rootId) as unknown as ArticleRow[];
    return rows.map(rowToArticle);
  }

  /** id -> parent id (null for root) for reconciliation. */
  getTopicGraph(rootId: string, shareableOnly = true): Map<string, string | null> {
    const where = shareableOnly ? 'AND status >= 1' : '';
    const rows = this.db
      .prepare(`SELECT id, parent_id FROM articles WHERE root_id = ? ${where}`)
      .all(rootId) as Array<{ id: string; parent_id: string | null }>;
    const graph = new Map<string, string | null>();
    for (const row of rows) graph.set(row.id, row.parent_id);
    return graph;
  }

  getTopicLeaves(rootId: string, shareableOnly = true): string[] {
    const where = shareableOnly ? 'AND a.status >= 1' : '';
    const rows = this.db
      .prepare(
        `SELECT a.id FROM articles a
         WHERE a.root_id = ? ${where}
           AND NOT EXISTS (
             SELECT 1 FROM articles b WHERE b.root_id = a.root_id AND b.parent_id = a.id
           )`,
      )
      .all(rootId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  setArticleStatus(id: string, status: number): void {
    const article = this.getArticle(id);
    if (!article) return;
    this.db.prepare('UPDATE articles SET status = ? WHERE id = ?').run(status, id);
    this.refreshTopic(article.rootId ?? article.id);
  }

  getArticlesByAuthor(author: string, from: number, to: number): SignedArticle[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM articles
         WHERE author = ? AND create_time >= ? AND create_time <= ? AND status >= 1
         ORDER BY create_time DESC`,
      )
      .all(author, from, to) as unknown as ArticleRow[];
    return rows.map(rowToArticle);
  }

  // --- topics ---------------------------------------------------------------

  /** Rebuilds the derived topic index for a root from its articles. */
  refreshTopic(rootId: string): TopicRecord | undefined {
    const root = this.getArticle(rootId);
    if (!root || root.parentId !== null) return undefined;

    const rows = this.db
      .prepare('SELECT id, create_time FROM articles WHERE root_id = ? AND status >= 1')
      .all(rootId) as Array<{ id: string; create_time: number }>;

    const ids = rows.map((row) => row.id);
    const lastTime = rows.reduce((max, row) => Math.max(max, row.create_time), root.createTime);
    const title = root.content.split('\n')[0]!.slice(0, LIMITS.MAX_TITLE_LEN);
    const status = this.getArticleStatus(rootId) ?? ARTICLE_STATUS.RECEIVE;
    const networkId = this.getArticleNetwork(rootId) ?? null;
    const record: TopicRecord = {
      rootId,
      title,
      labels: root.labels,
      count: ids.length,
      status,
      lastTime,
      snapshot: topicSnapshot(ids),
      networkId,
    };

    this.db
      .prepare(
        `INSERT INTO topics (root_id, title, labels, count, status, last_time, snapshot, network_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(root_id) DO UPDATE SET
           title = excluded.title, labels = excluded.labels, count = excluded.count,
           status = excluded.status, last_time = excluded.last_time,
           snapshot = excluded.snapshot, network_id = excluded.network_id`,
      )
      .run(
        record.rootId,
        record.title,
        JSON.stringify(record.labels),
        record.count,
        record.status,
        record.lastTime,
        record.snapshot,
        record.networkId,
      );

    return record;
  }

  private topicRowToRecord(row: Record<string, unknown>): TopicRecord {
    return {
      rootId: row.root_id as string,
      title: row.title as string,
      labels: parseLabels(row.labels),
      count: row.count as number,
      status: row.status as number,
      lastTime: row.last_time as number,
      snapshot: row.snapshot as string,
      networkId: (row.network_id as string | null) ?? null,
    };
  }

  getTopic(rootId: string): TopicRecord | undefined {
    const row = this.db.prepare('SELECT * FROM topics WHERE root_id = ?').get(rootId);
    return row ? this.topicRowToRecord(row) : undefined;
  }

  private networkFilter(
    networkId: string | null | undefined,
    clauses: string[],
    params: unknown[],
  ): void {
    if (networkId === undefined) return;
    if (networkId === null) {
      clauses.push('network_id IS NULL');
    } else {
      clauses.push('network_id = ?');
      params.push(networkId);
    }
  }

  listTopics(
    options: { limit?: number; label?: string; before?: number; networkId?: string | null } = {},
  ): TopicRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const clauses = ['status >= 1'];
    const params: unknown[] = [];
    if (options.label) {
      clauses.push('labels LIKE ?');
      params.push(`%"${options.label}"%`);
    }
    if (options.before !== undefined) {
      clauses.push('last_time <= ?');
      params.push(options.before);
    }
    this.networkFilter(options.networkId, clauses, params);
    const rows = this.db
      .prepare(
        `SELECT * FROM topics WHERE ${clauses.join(' AND ')}
         ORDER BY last_time DESC LIMIT ?`,
      )
      .all(...params, limit) as Record<string, unknown>[];
    return rows.map((row) => this.topicRowToRecord(row));
  }

  /** Topic heads to advertise during sync, filtered to a network + time window. */
  listTopicHeads(since: number | null, until: number | null, networkId: string | null): TopicHead[] {
    const clauses = ['status >= 1'];
    const params: unknown[] = [];
    if (since !== null) {
      clauses.push('last_time >= ?');
      params.push(since);
    }
    if (until !== null) {
      clauses.push('last_time <= ?');
      params.push(until);
    }
    this.networkFilter(networkId, clauses, params);
    const rows = this.db
      .prepare(
        `SELECT * FROM topics WHERE ${clauses.join(' AND ')}
         ORDER BY last_time DESC LIMIT ?`,
      )
      .all(...params, LIMITS.MAX_TOPIC_HEADS) as Record<string, unknown>[];

    return rows.map((row) => {
      const topic = this.topicRowToRecord(row);
      return {
        topicId: topic.rootId,
        title: topic.title,
        labels: topic.labels,
        count: topic.count,
        lastTime: topic.lastTime,
        snapshot: topic.snapshot,
      };
    });
  }

  // --- peers ----------------------------------------------------------------

  upsertPeer(peerId: string, multiaddrs: string[] = []): void {
    const existing = this.getPeer(peerId);
    const merged = existing
      ? [...new Set([...existing.multiaddrs, ...multiaddrs])].slice(0, 16)
      : multiaddrs.slice(0, 16);
    this.db
      .prepare(
        `INSERT INTO peers (peer_id, multiaddrs, level, fail_count, last_seen)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(peer_id) DO UPDATE SET
           multiaddrs = excluded.multiaddrs,
           last_seen = excluded.last_seen`,
      )
      .run(peerId, JSON.stringify(merged), PEER_LEVEL.DEFAULT, Date.now());
  }

  getPeer(peerId: string): PeerRecord | undefined {
    const row = this.db.prepare('SELECT * FROM peers WHERE peer_id = ?').get(peerId);
    if (!row) return undefined;
    return {
      peerId: row.peer_id as string,
      multiaddrs: parseLabels(row.multiaddrs),
      level: row.level as number,
      failCount: row.fail_count as number,
      lastSeen: row.last_seen as number,
      blocked: Boolean(row.blocked),
    };
  }

  listPeers(options: { exclude?: string; limit?: number } = {}): PeerRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? LIMITS.MAX_PEERS_SHARED, 200));
    const rows = this.db
      .prepare(
        `SELECT * FROM peers WHERE blocked = 0 AND peer_id != ?
         ORDER BY last_seen DESC LIMIT ?`,
      )
      .all(options.exclude ?? '', limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.getPeer(row.peer_id as string)!);
  }

  touchPeer(peerId: string, timestamp: number = Date.now()): void {
    this.db
      .prepare('UPDATE peers SET last_seen = ?, fail_count = 0 WHERE peer_id = ?')
      .run(timestamp, peerId);
  }

  adjustPeerLevel(peerId: string, delta: number): void {
    const peer = this.getPeer(peerId);
    if (!peer) return;
    this.db
      .prepare('UPDATE peers SET level = ? WHERE peer_id = ?')
      .run(clampLevel(peer.level + delta), peerId);
  }

  recordPeerFail(peerId: string): void {
    this.db
      .prepare('UPDATE peers SET fail_count = fail_count + 1 WHERE peer_id = ?')
      .run(peerId);
  }

  // --- networks -------------------------------------------------------------

  insertNetwork(info: NetworkInfo): void {
    this.db
      .prepare(
        `INSERT INTO networks (network_id, name, owner, salt, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(network_id) DO UPDATE SET
           name = excluded.name, owner = excluded.owner, salt = excluded.salt`,
      )
      .run(info.networkId, info.name, info.owner, info.salt, info.createdAt);
  }

  getNetwork(networkId: string): NetworkInfo | undefined {
    const row = this.db.prepare('SELECT * FROM networks WHERE network_id = ?').get(networkId);
    if (!row) return undefined;
    return {
      networkId: row.network_id as string,
      name: row.name as string,
      owner: row.owner as string,
      salt: row.salt as string,
      createdAt: row.created_at as number,
    };
  }

  listNetworks(): NetworkInfo[] {
    const rows = this.db
      .prepare('SELECT * FROM networks ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      networkId: row.network_id as string,
      name: row.name as string,
      owner: row.owner as string,
      salt: row.salt as string,
      createdAt: row.created_at as number,
    }));
  }

  // --- roster ops -----------------------------------------------------------

  hasRosterOp(opId: string): boolean {
    return this.db.prepare('SELECT 1 AS x FROM roster_ops WHERE op_id = ?').get(opId) !== undefined;
  }

  appendRosterOp(op: RosterOp): boolean {
    if (this.hasRosterOp(op.opId)) return false;
    this.db
      .prepare(
        `INSERT INTO roster_ops
           (op_id, network_id, op_type, subject, role, epoch, author, prev_hash, created_at, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        op.opId,
        op.networkId,
        op.opType,
        op.subject,
        op.role,
        op.epoch,
        op.author,
        op.prevHash,
        op.createdAt,
        op.signature,
      );
    return true;
  }

  getRosterOps(networkId: string): RosterOp[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM roster_ops WHERE network_id = ?
         ORDER BY epoch ASC, created_at ASC, op_id ASC`,
      )
      .all(networkId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      networkId: row.network_id as string,
      opType: row.op_type as RosterOp['opType'],
      subject: row.subject as string,
      role: (row.role as RosterOp['role']) ?? null,
      epoch: row.epoch as number,
      author: row.author as string,
      prevHash: (row.prev_hash as string | null) ?? null,
      createdAt: row.created_at as number,
      opId: row.op_id as string,
      signature: row.signature as string,
    }));
  }

  // --- invites --------------------------------------------------------------

  insertInvite(record: InviteRecord): void {
    this.db
      .prepare(
        `INSERT INTO invites (secret, network_id, inviter, expires_at, max_uses, used_count, revoked, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.secret,
        record.networkId,
        record.inviter,
        record.expiresAt,
        record.maxUses,
        record.usedCount,
        record.revoked ? 1 : 0,
        record.createdAt,
      );
  }

  getInvite(secret: string): InviteRecord | undefined {
    const row = this.db.prepare('SELECT * FROM invites WHERE secret = ?').get(secret);
    if (!row) return undefined;
    return {
      secret: row.secret as string,
      networkId: row.network_id as string,
      inviter: row.inviter as string,
      expiresAt: row.expires_at as number,
      maxUses: row.max_uses as number,
      usedCount: row.used_count as number,
      revoked: Boolean(row.revoked),
      createdAt: row.created_at as number,
    };
  }

  listInvites(networkId: string): InviteRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM invites WHERE network_id = ? ORDER BY created_at DESC')
      .all(networkId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.getInvite(row.secret as string)!);
  }

  consumeInvite(secret: string): void {
    this.db
      .prepare('UPDATE invites SET used_count = used_count + 1 WHERE secret = ?')
      .run(secret);
  }

  revokeInvite(secret: string): void {
    this.db.prepare('UPDATE invites SET revoked = 1 WHERE secret = ?').run(secret);
  }
}
