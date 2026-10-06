/**
 * Local daemon HTTP API for the web UI.
 *
 * Bound to loopback by default: the browser talks to the local node only.
 * The P2P side is libp2p; this server is purely a local control/read API plus
 * an SSE stream of newly received articles.
 *
 * An optional bearer token (`options.token`) protects every route except
 * `/health`; set it whenever the daemon is bound to a non-loopback interface.
 */
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { LIMITS, ARTICLE_ID_REGEX } from '@pforum/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { PFPNode } from './sync';

const NewTopicBody = z.object({
  content: z.string().min(1).max(LIMITS.CONTENT_BYTES),
  labels: z.array(z.string().min(1).max(LIMITS.MAX_LABEL_LEN)).max(LIMITS.MAX_LABELS).optional(),
  networkId: z.string().regex(ARTICLE_ID_REGEX).nullable().optional(),
});

const ReplyBody = z.object({
  content: z.string().min(1).max(LIMITS.CONTENT_BYTES),
  parentId: z.string().regex(ARTICLE_ID_REGEX).optional(),
});

const AddPeerBody = z.object({
  address: z.string().min(1),
});

const NewNetworkBody = z.object({
  name: z.string().min(1).max(LIMITS.MAX_NETWORK_NAME_LEN),
});

const InviteBody = z.object({
  expiresInMs: z.number().int().positive().optional(),
  maxUses: z.number().int().positive().optional(),
});

const JoinBody = z.object({
  code: z.string().min(1),
});

export interface DaemonOptions {
  host?: string;
  port?: number;
  /**
   * Optional bearer token. When set, every route except `GET /health`
   * requires `Authorization: Bearer <token>`. Strongly recommended if the
   * daemon is ever bound to a non-loopback interface.
   */
  token?: string;
  /**
   * Optional directory of a built web UI to serve at `/`. Used by the desktop
   * shell so the renderer loads over HTTP (same origin as the API) instead of
   * `file://`, which Chromium blocks for ES modules.
   */
  staticDir?: string;
}

export async function startDaemon(
  node: PFPNode,
  options: DaemonOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  if (options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      index: ['index.html'],
    });
  }

  if (options.token) {
    const expected = `Bearer ${options.token}`;
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/health')) return;
      // EventSource cannot send headers, so also accept ?token= for the SSE stream.
      const query = request.query as { token?: string } | undefined;
      if (request.headers.authorization === expected || query?.token === options.token) return;
      return reply.code(401).send({ error: 'unauthorized' });
    });
  }

  app.get('/health', async () => ({ ok: true }));

  app.get('/status', async () => node.status());

  app.get('/identity', async () => ({
    user: node.forum.identity.publicKey,
    node: node.peerId,
    multiaddrs: node.multiaddrs,
  }));

  app.get('/topics', async (request) => {
    const query = request.query as {
      limit?: string;
      label?: string;
      before?: string;
      network?: string;
    };
    const networkId =
      query.network === undefined ? undefined : query.network === 'public' ? null : query.network;
    return {
      topics: node.forum.listTopics({
        limit: query.limit ? Number(query.limit) : undefined,
        label: query.label,
        before: query.before ? Number(query.before) : undefined,
        networkId,
      }),
    };
  });

  app.post('/topics', async (request, reply) => {
    const parsed = NewTopicBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const article = await node.forum.post(
        { content: parsed.data.content, labels: parsed.data.labels ?? [] },
        parsed.data.networkId ?? null,
      );
      return reply.code(201).send({ topic: node.forum.getTopic(article.id), article });
    } catch (error) {
      return reply.code(403).send({ error: (error as Error).message });
    }
  });

  app.get('/topics/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const topic = node.forum.getTopic(id);
    if (!topic) return reply.code(404).send({ error: 'topic not found' });
    return { topic, articles: node.forum.getTopicTree(id) };
  });

  app.post('/topics/:id/reply', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ReplyBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const topic = node.forum.getTopic(id);
    if (!topic) return reply.code(404).send({ error: 'topic not found' });
    const article = await node.forum.post({
      content: parsed.data.content,
      rootId: id,
      parentId: parsed.data.parentId ?? id,
    });
    return reply.code(201).send({ article });
  });

  app.get('/peers', async () => ({
    peers: node.forum.peers.list({ exclude: node.peerId, limit: 200 }),
  }));

  app.post('/peers', async (request, reply) => {
    const parsed = AddPeerBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const peerId = await node.addPeer(parsed.data.address);
      return reply.code(201).send({ peerId });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post('/sync', async () => ({ reports: await node.syncRound() }));

  // --- networks -------------------------------------------------------------

  app.get('/networks', async () => ({ networks: node.forum.listNetworks() }));

  app.post('/networks', async (request, reply) => {
    const parsed = NewNetworkBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const network = await node.createNetwork(parsed.data.name);
    return reply.code(201).send({ network });
  });

  app.post('/networks/join', async (request, reply) => {
    const parsed = JoinBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const network = await node.joinNetwork(parsed.data.code);
      return reply.code(201).send({ network });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get('/networks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const view = node.forum.getNetworkView(id);
    if (!view) return reply.code(404).send({ error: 'network not found' });
    return view;
  });

  app.post('/networks/:id/invites', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = InviteBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const { code } = await node.createInvite(id, parsed.data);
      return reply.code(201).send({ code });
    } catch (error) {
      return reply.code(403).send({ error: (error as Error).message });
    }
  });

  app.delete('/networks/:id/members/:pubkey', async (request, reply) => {
    const { id, pubkey } = request.params as { id: string; pubkey: string };
    try {
      const op = await node.removeMember(id, pubkey);
      return { ok: true, op };
    } catch (error) {
      return reply.code(403).send({ error: (error as Error).message });
    }
  });

  app.get('/users/:author/posts', async (request) => {
    const { author } = request.params as { author: string };
    const query = request.query as { from?: string; to?: string };
    return {
      posts: node.forum.userPosts(
        author,
        query.from ? Number(query.from) : 0,
        query.to ? Number(query.to) : Date.now(),
      ),
    };
  });

  // Server-Sent Events: stream newly stored articles to the UI.
  app.get('/events', (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    response.write(': connected\n\n');

    const onArticle = (article: unknown): void => {
      response.write(`data: ${JSON.stringify(article)}\n\n`);
    };
    node.forum.events.on('article', onArticle);

    const keepAlive = setInterval(() => response.write(': ping\n\n'), 15_000);
    request.raw.on('close', () => {
      clearInterval(keepAlive);
      node.forum.events.off('article', onArticle);
    });
  });

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 7331 });
  return app;
}
