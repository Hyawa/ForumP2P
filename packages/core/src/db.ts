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

let databaseSyncCtor: DatabaseSyncConstructor | undefined;

/**
 * Lazily loads the built-in `node:sqlite` (Node >= 22). Kept lazy so the WASM
 * driver can run on Node 18 (mobile), where `node:sqlite` does not exist.
 * The computed specifier keeps bundlers from trying to resolve the built-in.
 */
function loadNodeSqlite(): DatabaseSyncConstructor {
  if (databaseSyncCtor) return databaseSyncCtor;
  const nodeRequire = createRequire(import.meta.url);
  const sqliteSpecifier = ['node', 'sqlite'].join(':');
  databaseSyncCtor = (nodeRequire(sqliteSpecifier) as { DatabaseSync: DatabaseSyncConstructor })
    .DatabaseSync;
  return databaseSyncCtor;
}

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

/** Applies the schema + migrations. Shared by every driver. */
function initializeSchema(db: SqlDatabase): SqlDatabase {
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

/** Built-in `node:sqlite` driver (Node >= 22). Used by desktop/servers/tests. */
function openNodeDatabase(location: string): SqlDatabase {
  const DatabaseSync = loadNodeSqlite();
  const db = new DatabaseSync(location);
  if (location !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  return initializeSchema(db);
}

// --- WebAssembly driver (portable; used by the mobile Node 18 runtime) -------

interface WasmRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

interface WasmDatabase {
  exec(sql: string): void;
  run(sql: string, values?: unknown): WasmRunResult;
  get(sql: string, values?: unknown): Record<string, unknown> | null;
  all(sql: string, values?: unknown): Record<string, unknown>[];
  close(): void;
}

interface WasmModule {
  Database: new (filename?: string) => WasmDatabase;
}

/**
 * Converts our variadic `prepare(...).run(a, b, c)` calls into the single
 * `values` argument that `node-sqlite3-wasm` expects.
 */
function bindParams(params: unknown[]): unknown {
  if (params.length === 0) return undefined;
  if (params.length === 1) return params[0];
  return params;
}

/**
 * `node-sqlite3-wasm` driver: pure WebAssembly SQLite with direct file access.
 * It is loaded via `createRequire` so bundlers leave it external (its `.wasm`
 * is resolved at runtime from the package directory).
 */
function openWasmDatabase(location: string): SqlDatabase {
  const nodeRequire = createRequire(import.meta.url);
  const { Database } = nodeRequire('node-sqlite3-wasm') as WasmModule;
  const db = new Database(location);
  const adapter: SqlDatabase = {
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    prepare: (sql) => ({
      run: (...params) => db.run(sql, bindParams(params)),
      get: (...params) => db.get(sql, bindParams(params)) ?? undefined,
      all: (...params) => db.all(sql, bindParams(params)),
    }),
  };
  // WAL is a filesystem feature the WASM VFS does not provide; skip it here.
  return initializeSchema(adapter);
}

export type SqliteDriver = 'node' | 'wasm';

/**
 * Opens a SQLite database with the chosen driver.
 * - `node` (default): built-in `node:sqlite` (Node >= 22).
 * - `wasm`: `node-sqlite3-wasm` (works on Node 18, e.g. the mobile runtime).
 */
export function openDatabase(location: string, driver: SqliteDriver = 'node'): SqlDatabase {
  return driver === 'wasm' ? openWasmDatabase(location) : openNodeDatabase(location);
}

export { SCHEMA };
