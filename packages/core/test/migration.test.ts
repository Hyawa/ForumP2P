import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Forum } from '../src/forum';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire(['node', 'sqlite'].join(':')) as {
  DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
};

describe('schema migration', () => {
  it('adds network columns to a database created before networks existed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pforum-migrate-'));
    const dbPath = join(dir, 'legacy.db');

    // Recreate the pre-networks schema: articles/topics without network_id.
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE articles (
        id TEXT PRIMARY KEY, root_id TEXT NOT NULL, parent_id TEXT, author TEXT NOT NULL,
        type INTEGER, content TEXT, labels TEXT, signature TEXT, create_time INTEGER,
        destroy_time INTEGER, status INTEGER, received_at INTEGER, from_peer TEXT
      );
      CREATE TABLE topics (
        root_id TEXT PRIMARY KEY, title TEXT, labels TEXT, count INTEGER,
        status INTEGER, last_time INTEGER, snapshot TEXT
      );
    `);
    legacy.close();

    const forum = await Forum.open({ dbPath });
    const network = await forum.createNetwork('Legacy');
    await forum.post({ content: 'after migration\nbody' }, network.networkId);

    expect(forum.listTopics({ networkId: network.networkId })).toHaveLength(1);
    forum.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
