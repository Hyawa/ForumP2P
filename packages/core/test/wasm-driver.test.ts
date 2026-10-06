import { describe, expect, it } from 'vitest';

import { openDatabase } from '../src/db';
import { Forum } from '../src/forum';

describe('wasm sqlite driver', () => {
  it('runs the schema and basic CRUD', () => {
    const db = openDatabase(':memory:', 'wasm');
    try {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
      const result = db.prepare('INSERT INTO t (name) VALUES (?)').run('a');
      expect(result.changes).toBe(1);
      expect(db.prepare('SELECT name FROM t WHERE id = ?').get(1)).toEqual({ name: 'a' });
      expect(db.prepare('SELECT * FROM t').all()).toHaveLength(1);
      // A missing row must be `undefined` (not `null`) to match `node:sqlite`.
      expect(db.prepare('SELECT * FROM t WHERE id = ?').get(999)).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('drives a Forum end to end', async () => {
    const forum = await Forum.open({ dbPath: ':memory:', driver: 'wasm' });
    try {
      const root = await forum.post({ content: 'wasm topic\nbody', labels: ['x'] });
      await forum.post({ content: 'reply', rootId: root.id, parentId: root.id });

      const topics = forum.listTopics();
      expect(topics).toHaveLength(1);
      expect(topics[0]).toMatchObject({ rootId: root.id, title: 'wasm topic', count: 2 });

      const network = await forum.createNetwork('WasmNet');
      expect(forum.listNetworks()).toHaveLength(1);
      expect(forum.isMember(network.networkId, forum.identity.publicKey)).toBe(true);
    } finally {
      forum.close();
    }
  });
});
