import { beforeEach, describe, expect, it } from 'vitest';

import { Forum } from '../src/forum';

async function makeForum(): Promise<Forum> {
  return Forum.open({ dbPath: ':memory:' });
}

describe('Forum', () => {
  let alice: Forum;
  let bob: Forum;

  beforeEach(async () => {
    alice = await makeForum();
    bob = await makeForum();
  });

  it('creates a topic and derives its index', async () => {
    const root = await alice.post({ content: 'First topic\nbody text', labels: ['tech'] });
    const topics = alice.listTopics();

    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ rootId: root.id, title: 'First topic', count: 1 });
    expect(topics[0]!.labels).toEqual(['tech']);
    expect(alice.getTopicTree(root.id)).toHaveLength(1);
  });

  it('appends replies and tracks leaves', async () => {
    const root = await alice.post({ content: 'Topic' });
    const reply = await alice.post({ content: 'reply', rootId: root.id, parentId: root.id });

    expect(alice.getTopic(root.id)?.count).toBe(2);
    expect(alice.topicLeaves(root.id)).toEqual([reply.id]);
  });

  it('converges two peers through reconciliation', async () => {
    const root = await alice.post({ content: 'Shared topic' });
    await alice.post({ content: 'reply one', rootId: root.id, parentId: root.id });

    // Bob is fresh: Alice sends the whole topic.
    const full = alice.postsToSend(root.id, bob.topicLeaves(root.id));
    await bob.ingestBatch(full, 'alice');
    expect(bob.getTopic(root.id)?.snapshot).toBe(alice.getTopic(root.id)?.snapshot);

    // Alice adds a second reply; Bob now only needs the delta.
    const reply2 = await alice.post({ content: 'reply two', rootId: root.id, parentId: root.id });
    const delta = alice.postsToSend(root.id, bob.topicLeaves(root.id));
    expect(delta.map((a) => a.id)).toEqual([reply2.id]);

    await bob.ingestBatch(delta, 'alice');
    expect(bob.getTopic(root.id)?.snapshot).toBe(alice.getTopic(root.id)?.snapshot);
    expect(bob.getTopic(root.id)?.count).toBe(3);
  });

  it('rejects tampered content', async () => {
    const root = await alice.post({ content: 'original' });
    const tampered = { ...root, content: 'tampered' };

    const result = await bob.ingest(tampered, 'alice');
    expect(result.status).toBe('invalid');
    expect(bob.getTopic(root.id)).toBeUndefined();
  });

  it('handles out-of-order delivery (reply before root)', async () => {
    const root = await alice.post({ content: 'Topic' });
    const reply = await alice.post({ content: 'reply', rootId: root.id, parentId: root.id });

    await bob.ingest(reply, 'alice');
    expect(bob.getTopic(root.id)).toBeUndefined();

    await bob.ingest(root, 'alice');
    expect(bob.getTopic(root.id)?.count).toBe(2);
    expect(bob.getTopicTree(root.id)).toHaveLength(2);
  });

  it('indexes a user timeline', async () => {
    const root = await alice.post({ content: 'post by alice' });
    const posts = alice.userPosts(alice.identity.publicKey, 0, Date.now());

    expect(posts.map((p) => p.id)).toContain(root.id);
    expect(alice.userPosts(bob.identity.publicKey, 0, Date.now())).toHaveLength(0);
  });
});
