import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { startDaemon } from '../src/daemon';
import { PFPNode } from '../src/sync';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

async function makeDaemon(options: { token?: string } = {}): Promise<{ node: PFPNode; base: string }> {
  const node = await PFPNode.create({
    dbPath: ':memory:',
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableMdns: false,
    autoSync: false,
  });
  const app = await startDaemon({ current: node }, { host: '127.0.0.1', port: 0, token: options.token });
  const address = app.server.address() as AddressInfo;
  cleanups.push(async () => {
    await app.close();
    await node.stop();
  });
  return { node, base: `http://127.0.0.1:${address.port}` };
}

describe('local daemon API', () => {
  it('creates and lists topics over HTTP', async () => {
    const { base } = await makeDaemon();

    const created = await fetch(`${base}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'daemon topic\nbody', labels: ['api'] }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { topic: { rootId: string } };

    const list = (await (await fetch(`${base}/topics`)).json()) as {
      topics: Array<{ rootId: string }>;
    };
    expect(list.topics).toHaveLength(1);
    expect(list.topics[0]!.rootId).toBe(createdBody.topic.rootId);

    const detail = (await (await fetch(`${base}/topics/${createdBody.topic.rootId}`)).json()) as {
      articles: unknown[];
    };
    expect(detail.articles).toHaveLength(1);
  });

  it('reports node status and identity', async () => {
    const { node, base } = await makeDaemon();
    const status = (await (await fetch(`${base}/status`)).json()) as {
      peerId: string;
      user: string;
    };
    expect(status.peerId).toBe(node.peerId);
    expect(status.user).toMatch(/^[0-9a-f]{64}$/);
  });

  it('enforces a bearer token when configured', async () => {
    const { base } = await makeDaemon({ token: 'sekret' });

    expect((await fetch(`${base}/health`)).status).toBe(200);

    const denied = await fetch(`${base}/status`);
    expect(denied.status).toBe(401);

    const allowed = await fetch(`${base}/status`, {
      headers: { authorization: 'Bearer sekret' },
    });
    expect(allowed.status).toBe(200);
  });

  it('creates a network, invites, and syncs over HTTP', async () => {
    const owner = await makeDaemon();
    const guest = await makeDaemon();

    const created = (await (
      await fetch(`${owner.base}/networks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'HTTPNet' }),
      })
    ).json()) as { network: { networkId: string } };
    const networkId = created.network.networkId;

    const invite = (await (
      await fetch(`${owner.base}/networks/${networkId}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxUses: 1 }),
      })
    ).json()) as { code: string };
    expect(invite.code.startsWith('PFPJOIN1.')).toBe(true);

    const joined = (await (
      await fetch(`${guest.base}/networks/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: invite.code }),
      })
    ).json()) as { network: { networkId: string } };
    expect(joined.network.networkId).toBe(networkId);

    await fetch(`${owner.base}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'network post over HTTP', networkId }),
    });

    await fetch(`${guest.base}/sync`, { method: 'POST' });
    const topics = (await (
      await fetch(`${guest.base}/topics?network=${networkId}`)
    ).json()) as { topics: unknown[] };
    expect(topics.topics).toHaveLength(1);
  });
});
