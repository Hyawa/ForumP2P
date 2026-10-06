/**
 * SQLite access layer built on Node's built-in `node:sqlite` (Node >= 22).
 * Using the built-in avoids a native build step while keeping everything
 * local-first, exactly like the original PeerForum's sqlite storage.
 *
 * The module is loaded via `createRequire` with a computed specifier so that
 * bundlers (Vite/Vitest) do not try to resolve the still-unlisted built-in.
 */
import { createRequire } from 'node:module';

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

interface DatabaseSyncInstance extends SqlDatabase {}

interface DatabaseSyncConstructor {
  new (location: string): DatabaseSyncInstance;
}

const nodeRequire = createRequire(import.meta.url);
const sqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = nodeRequire(sqliteSpecifier) as {
  DatabaseSync: DatabaseSyncConstructor;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS identity (
  kind        TEXT PRIMARY KEY,
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS peers (
  peer_id     TEXT PRIMARY KEY,
  multiaddrs  TEXT NOT NULL DEFAULT '[]',
  level       INTEGER NOT NULL DEFAULT 20,
  fail_count  INTEGER NOT NULL DEFAULT 0,
  last_seen   INTEGER NOT NULL DEFAULT 0,
  blocked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id           TEXT PRIMARY KEY,
  root_id      TEXT NOT NULL,
  parent_id    TEXT,
  author       TEXT NOT NULL,
  type         INTEGER NOT NULL DEFAULT 0,
  content      TEXT NOT NULL DEFAULT '',
  labels       TEXT NOT NULL DEFAULT '[]',
  signature    TEXT NOT NULL,
  create_time  INTEGER NOT NULL,
  destroy_time INTEGER,
  status       INTEGER NOT NULL DEFAULT 0,
  received_at  INTEGER NOT NULL,
  from_peer    TEXT,
  network_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_articles_root ON articles(root_id);
CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author, create_time);
CREATE INDEX IF NOT EXISTS idx_articles_parent ON articles(root_id, parent_id);

CREATE TABLE IF NOT EXISTS topics (
  root_id   TEXT PRIMARY KEY,
  title     TEXT NOT NULL DEFAULT '',
  labels    TEXT NOT NULL DEFAULT '[]',
  count     INTEGER NOT NULL DEFAULT 0,
  status    INTEGER NOT NULL DEFAULT 0,
  last_time INTEGER NOT NULL DEFAULT 0,
  snapshot  TEXT NOT NULL DEFAULT '',
  network_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_topics_time ON topics(last_time);

CREATE TABLE IF NOT EXISTS networks (
  network_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner      TEXT NOT NULL,
  salt       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roster_ops (
  op_id      TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  op_type    TEXT NOT NULL,
  subject    TEXT NOT NULL,
  role       TEXT,
  epoch      INTEGER NOT NULL,
  author     TEXT NOT NULL,
  prev_hash  TEXT,
  created_at INTEGER NOT NULL,
  signature  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roster_network ON roster_ops(network_id, epoch, created_at);

CREATE TABLE IF NOT EXISTS invites (
  secret      TEXT PRIMARY KEY,
  network_id  TEXT NOT NULL,
  inviter     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  max_uses    INTEGER NOT NULL DEFAULT 1,
  used_count  INTEGER NOT NULL DEFAULT 0,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_network ON invites(network_id);
`;

function ensureColumn(
  db: SqlDatabase,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openDatabase(location: string): SqlDatabase {
  const db = new DatabaseSync(location);
  if (location !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Migrate databases created before networks existed. The columns must exist
  // before the network indexes are created.
  ensureColumn(db, 'articles', 'network_id', 'TEXT');
  ensureColumn(db, 'topics', 'network_id', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_articles_network ON articles(network_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_topics_network ON topics(network_id);');
  return db;
}

export { SCHEMA };
