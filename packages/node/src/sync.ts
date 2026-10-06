/**
 * PFPNode: a running peer.
 *
 * Wires the Forum (storage/model) to a libp2p node, registers the PFP stream
 * handlers, tracks peers and runs the periodic sync loop. This is the modern
 * counterpart to the original `PeerForum` class + its `cmdDida` heartbeat.
 *
 * Networks add a signed binding between the transport PeerID and the user key
 * (the `/pforum/hello` handshake), so membership can be enforced per person.
 */
import type { Connection, Stream } from '@libp2p/interface';
import { multiaddr, type Multiaddr } from '@multiformats/multiaddr';
import { Forum } from '@pforum/core';
import {
  PFP_PROTOCOLS,
  decodeInviteCode,
  signHello,
  verifyHello,
  verifyInvite,
  type HelloBinding,
  type Message,
  type NetworkInfo,
  type RosterOp,
} from '@pforum/protocol';

import { DEFAULT_CONFIG, type PFPNodeConfig } from './config';
import { createPfpLibp2p, type PfpLibp2p } from './libp2p-node';
import { requestResponse, serveSingle } from './rpc';
import { isOnionMultiaddr } from './transports/tor';

export interface SyncReport {
  peerId: string;
  topics: number;
  requested: number;
  stored: number;
}

export interface NodeStatus {
  peerId: string;
  user: string;
  multiaddrs: string[];
  peers: number;
  topics: number;
  networks: number;
}

export interface CreateInviteOptions {
  expiresInMs?: number;
  maxUses?: number;
}

interface DirectoryEntry {
  user: string;
  addrs: string[];
}

/** Extracts the /p2p/<peerId> component from a multiaddr, if present. */
function peerIdFromMultiaddr(addr: Multiaddr): string | undefined {
  for (const component of addr.getComponents()) {
    if (component.name === 'p2p' || component.name === 'ipfs') return component.value;
  }
  return undefined;
}

/**
 * Prefers a /p2p-qualified multiaddr: dialing a bare address (no peer id)
 * works once but breaks subsequent dials to the same peer. In Tor mode only
 * onion addresses are ever returned.
 */
function pickDialable(addrs: string[], preferOnion = false): string | undefined {
  const usable = preferOnion ? addrs.filter(isOnionString) : addrs;
  return usable.find((addr) => addr.includes('/p2p/')) ?? usable[0];
}

function isOnionString(addr: string): boolean {
  return addr.includes('/onion3/') || addr.includes('/onion/');
}

export class PFPNode {
  private syncTimer?: ReturnType<typeof setInterval>;
  /** Verified PeerID -> user bindings observed this session. */
  private readonly directory = new Map<string, DirectoryEntry>();

  private constructor(
    readonly forum: Forum,
    readonly libp2p: PfpLibp2p,
    readonly config: PFPNodeConfig,
  ) {}

  static async create(options: Partial<PFPNodeConfig> = {}): Promise<PFPNode> {
    // Ignore keys explicitly set to undefined so they do not clobber defaults.
    const defined = Object.fromEntries(
      Object.entries(options).filter(([, value]) => value !== undefined),
    );
    const config: PFPNodeConfig = { ...DEFAULT_CONFIG, ...defined };

    const forum = await Forum.open({
      dbPath: config.dbPath,
      autoAcceptReceived: config.autoAcceptReceived,
      driver: config.dbDriver,
    });
    const nodeIdentity = await forum.ensureNodeIdentity();
    const libp2p = await createPfpLibp2p({
      seedHex: nodeIdentity.privateKey,
      listen: config.listen,
      bootstrap: config.bootstrap,
      enableMdns: config.enableMdns,
      tor: config.tor,
    });

    const node = new PFPNode(forum, libp2p, config);
    await node.registerHandlers();
    node.registerDiscovery();
    await node.waitForAddresses();
    if (config.autoSync) node.startSyncLoop();
    return node;
  }

  /**
   * Listening on a wildcard address can resolve interface addresses a moment
   * after startup; wait briefly so generated invites/hello bindings carry them.
   */
  private async waitForAddresses(timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (this.multiaddrs.length === 0 && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  get peerId(): string {
    return this.libp2p.peerId.toString();
  }

  get multiaddrs(): string[] {
    return this.libp2p.getMultiaddrs().map((addr) => addr.toString());
  }

  /** True when the node is in anonymous (Tor) mode. */
  get anonymous(): boolean {
    return this.config.tor != null;
  }

  /**
   * In Tor mode, only onion addresses are considered; clearnet addresses are
   * dropped everywhere (hello bindings, peer gossip, invites, dials).
   */
  private sharesAddrs(addrs: string[]): string[] {
    return this.anonymous ? addrs.filter(isOnionString) : addrs;
  }

  private dialTarget(addrs: string[]): string | undefined {
    return pickDialable(addrs, this.anonymous);
  }

  status(): NodeStatus {
    return {
      peerId: this.peerId,
      user: this.forum.identity.publicKey,
      multiaddrs: this.multiaddrs,
      peers: this.forum.peers.list({ exclude: this.peerId, limit: 1000 }).length,
      topics: this.forum.listTopics({ limit: 1000 }).length,
      networks: this.forum.listNetworks().length,
    };
  }

  async stop(): Promise<void> {
    if (this.syncTimer) clearInterval(this.syncTimer);
    await this.libp2p.stop();
    this.forum.close();
  }

  // --- identity binding -----------------------------------------------------

  private async buildHello(): Promise<HelloBinding> {
    const user = this.forum.identity.publicKey;
    const addrs = this.sharesAddrs(this.multiaddrs);
    const signature = await signHello(
      { user, peerId: this.peerId, addrs },
      this.forum.identity.privateKey,
    );
    return { user, peerId: this.peerId, addrs, signature };
  }

  private async cacheBinding(binding: HelloBinding, expectedPeerId?: string): Promise<boolean> {
    if (expectedPeerId && binding.peerId !== expectedPeerId) return false;
    const ok = await verifyHello(
      { user: binding.user, peerId: binding.peerId, addrs: binding.addrs },
      binding.signature,
    );
    if (!ok) return false;
    const addrs = this.sharesAddrs(binding.addrs);
    this.directory.set(binding.peerId, { user: binding.user, addrs });
    if (addrs.length > 0) this.forum.peers.upsert(binding.peerId, addrs);
    return true;
  }

  private userFor(remotePeerId: string): string | undefined {
    return this.directory.get(remotePeerId)?.user;
  }

  private canServeNetwork(networkId: string, remotePeerId: string): boolean {
    const user = this.userFor(remotePeerId);
    return user !== undefined && this.forum.isMember(networkId, user);
  }

  /** Identifies this node to a peer and learns (and verifies) theirs. */
  async identifyTo(target: Multiaddr): Promise<string> {
    const expectedPeerId = peerIdFromMultiaddr(target);
    const hello = await this.buildHello();
    const reply = await this.rpc(target, PFP_PROTOCOLS.hello, { type: 'Hello', ...hello });
    if (reply.type !== 'HelloAck') {
      throw new Error(reply.type === 'Error' ? reply.message : 'hello failed');
    }
    if (!(await this.cacheBinding(reply, expectedPeerId))) {
      throw new Error('invalid hello acknowledgement');
    }
    return reply.user;
  }

  // --- handlers -------------------------------------------------------------

  private async registerHandlers(): Promise<void> {
    await this.libp2p.handle(PFP_PROTOCOLS.hello, (stream, connection) =>
      this.handleHello(stream, connection),
    );
    await this.libp2p.handle(PFP_PROTOCOLS.sync, (stream, connection) =>
      this.handleStream(stream, connection, this.syncHandler),
    );
    await this.libp2p.handle(PFP_PROTOCOLS.peers, (stream, connection) =>
      this.handleStream(stream, connection, this.peersHandler),
    );
    await this.libp2p.handle(PFP_PROTOCOLS.timeline, (stream, connection) =>
      this.handleStream(stream, connection, this.timelineHandler),
    );
    await this.libp2p.handle(PFP_PROTOCOLS.networks, (stream, connection) =>
      this.handleStream(stream, connection, this.networksHandler),
    );
  }

  private registerDiscovery(): void {
    this.libp2p.addEventListener('peer:discovery', (event) => {
      const { id, multiaddrs } = event.detail;
      const addresses = this.sharesAddrs(multiaddrs.map((addr) => addr.toString()));
      if (addresses.length > 0) this.forum.peers.upsert(id.toString(), addresses);
    });
    this.libp2p.addEventListener('peer:connect', (event) => {
      this.forum.peers.touch(event.detail.toString());
    });
  }

  private async handleHello(stream: Stream, connection: Connection): Promise<void> {
    const remotePeer = connection.remotePeer.toString();
    this.forum.peers.upsert(remotePeer);
    await serveSingle(stream, async (message) => {
      if (message.type !== 'Hello') return { type: 'Error', message: 'expected Hello' };
      const ok = await this.cacheBinding(message, remotePeer);
      if (!ok) return { type: 'Error', message: 'invalid hello binding' };
      const hello = await this.buildHello();
      return { type: 'HelloAck', ...hello };
    });
    this.forum.peers.touch(remotePeer);
  }

  private async handleStream(
    stream: Stream,
    connection: Connection,
    handler: (message: Message, remotePeerId: string) => Promise<Message> | Message,
  ): Promise<void> {
    const remotePeer = connection.remotePeer.toString();
    this.forum.peers.upsert(remotePeer);
    await serveSingle(stream, (message) => handler(message, remotePeer));
    this.forum.peers.touch(remotePeer);
  }

  private syncHandler = (message: Message, remotePeerId: string): Message => {
    switch (message.type) {
      case 'GetTopicHeads': {
        const { networkId } = message;
        if (networkId !== null && !this.canServeNetwork(networkId, remotePeerId)) {
          return { type: 'Error', message: 'not a member of this network' };
        }
        return {
          type: 'TopicHeads',
          heads: this.forum.listTopicHeads(message.since, message.until, networkId),
        };
      }
      case 'GetPosts': {
        const { networkId } = message;
        if (networkId !== null) {
          if (!this.canServeNetwork(networkId, remotePeerId)) {
            return { type: 'Error', message: 'not a member of this network' };
          }
          const topic = this.forum.getTopic(message.topicId);
          if (topic && topic.networkId !== networkId) {
            return { type: 'Error', message: 'topic is not in this network' };
          }
        }
        return { type: 'Posts', articles: this.forum.postsToSend(message.topicId, message.have) };
      }
      default:
        return { type: 'Error', message: `unsupported message on sync protocol: ${message.type}` };
    }
  };

  private networksHandler = async (message: Message, remotePeerId: string): Promise<Message> => {
    switch (message.type) {
      case 'GetRoster': {
        const user = this.userFor(remotePeerId);
        if (!user || !this.forum.isMember(message.networkId, user)) {
          return { type: 'Error', message: 'not a member of this network' };
        }
        const network = this.forum.getNetwork(message.networkId);
        if (!network) return { type: 'Error', message: 'unknown network' };
        return { type: 'Roster', network, ops: this.forum.rosterOps(message.networkId) };
      }
      case 'JoinRequest': {
        const ok = await this.cacheBinding(message.hello, remotePeerId);
        if (!ok) return { type: 'Error', message: 'invalid hello binding' };
        try {
          const { network, ops } = await this.forum.acceptJoin(message.invite, message.hello.user);
          return { type: 'JoinAccepted', network, ops };
        } catch (error) {
          return { type: 'Error', message: (error as Error).message };
        }
      }
      case 'PushOps': {
        await this.forum.applyRosterOps(message.networkId, message.ops);
        const network = this.forum.getNetwork(message.networkId);
        if (!network) return { type: 'Error', message: 'unknown network' };
        return { type: 'Roster', network, ops: this.forum.rosterOps(message.networkId) };
      }
      default:
        return {
          type: 'Error',
          message: `unsupported message on networks protocol: ${message.type}`,
        };
    }
  };

  private peersHandler = (message: Message): Message => {
    if (message.type !== 'GetPeers') {
      return { type: 'Error', message: `unsupported message on peers protocol: ${message.type}` };
    }
    const peers = this.forum.peers.list({ exclude: this.peerId });
    return {
      type: 'Peers',
      peers: peers.map((peer) => ({ peerId: peer.peerId, multiaddrs: peer.multiaddrs })),
    };
  };

  private timelineHandler = (message: Message): Message => {
    if (message.type !== 'GetUserPosts') {
      return { type: 'Error', message: `unsupported message on timeline protocol: ${message.type}` };
    }
    return {
      type: 'Posts',
      articles: this.forum.userPosts(message.author, message.from, message.to),
    };
  };

  // --- client-side protocol calls ------------------------------------------

  private async rpc(target: Multiaddr, protocol: string, message: Message): Promise<Message> {
    const signal = AbortSignal.timeout(this.config.rpcTimeoutMs);
    const stream = await this.libp2p.dialProtocol(target, protocol, { signal });
    return requestResponse(stream, message, this.config.rpcTimeoutMs);
  }

  /** Pulls every divergent topic (public or within a network) from a peer. */
  async syncWithPeer(address: string, networkId: string | null = null): Promise<SyncReport> {
    const target = multiaddr(address);
    const peerId = peerIdFromMultiaddr(target) ?? target.toString();

    if (networkId !== null) {
      await this.identifyTo(target);
      try {
        const roster = await this.rpc(target, PFP_PROTOCOLS.networks, {
          type: 'GetRoster',
          networkId,
        });
        if (roster.type === 'Roster') {
          this.forum.rememberNetwork(roster.network);
          await this.forum.applyRosterOps(networkId, roster.ops);
        }
      } catch {
        /* roster refresh is best-effort; membership checks still apply */
      }
    }

    const heads = await this.rpc(target, PFP_PROTOCOLS.sync, {
      type: 'GetTopicHeads',
      since: null,
      until: null,
      networkId,
    });
    if (heads.type !== 'TopicHeads') throw new Error(`unexpected reply: ${heads.type}`);

    let requested = 0;
    let stored = 0;

    for (const head of heads.heads) {
      const local = this.forum.getTopic(head.topicId);
      if (local && local.snapshot === head.snapshot) continue;
      requested += 1;

      const have = this.forum.topicLeaves(head.topicId);
      const posts = await this.rpc(target, PFP_PROTOCOLS.sync, {
        type: 'GetPosts',
        topicId: head.topicId,
        have,
        networkId,
      });
      if (posts.type === 'Posts') {
        const result = await this.forum.ingestBatch(posts.articles, peerId, networkId);
        stored += result.stored;
      }
    }

    this.forum.peers.touch(peerId);
    return { peerId, topics: heads.heads.length, requested, stored };
  }

  /** Asks a peer for more peers (gossip) and records what we learn. */
  async discoverFromPeer(address: string): Promise<number> {
    const target = multiaddr(address);
    const reply = await this.rpc(target, PFP_PROTOCOLS.peers, { type: 'GetPeers' });
    if (reply.type !== 'Peers') return 0;

    let learned = 0;
    for (const peer of reply.peers) {
      if (peer.peerId === this.peerId) continue;
      const addrs = this.sharesAddrs(peer.multiaddrs);
      if (addrs.length === 0) continue;
      this.forum.peers.upsert(peer.peerId, addrs);
      learned += 1;
    }
    return learned;
  }

  // --- networks -------------------------------------------------------------

  async createNetwork(name: string): Promise<NetworkInfo> {
    return this.forum.createNetwork(name);
  }

  async createInvite(
    networkId: string,
    options: CreateInviteOptions = {},
  ): Promise<{ code: string }> {
    const { code } = await this.forum.createInvite(
      networkId,
      options,
      this.sharesAddrs(this.multiaddrs),
    );
    return { code };
  }

  /** Redeems an invite code against the inviter's node and joins the network. */
  async joinNetwork(code: string): Promise<NetworkInfo> {
    const invite = decodeInviteCode(code);
    if (!(await verifyInvite(invite))) throw new Error('invalid invite signature');

    const address = this.dialTarget(invite.addrs);
    if (!address) throw new Error('invite has no reachable address');
    const target = multiaddr(address);
    const inviterPeer = peerIdFromMultiaddr(target);

    await this.identifyTo(target);
    const hello = await this.buildHello();
    const reply = await this.rpc(target, PFP_PROTOCOLS.networks, {
      type: 'JoinRequest',
      invite,
      hello,
    });
    if (reply.type !== 'JoinAccepted') {
      throw new Error(reply.type === 'Error' ? reply.message : 'join failed');
    }
    this.forum.rememberNetwork(reply.network);
    await this.forum.applyRosterOps(reply.network.networkId, reply.ops);
    if (inviterPeer) this.forum.peers.upsert(inviterPeer, [address]);
    return reply.network;
  }

  async removeMember(networkId: string, user: string): Promise<RosterOp> {
    const op = await this.forum.removeMember(networkId, user);
    await this.pushRoster(networkId);
    return op;
  }

  private async pushRoster(networkId: string): Promise<void> {
    const ops = this.forum.rosterOps(networkId);
    const peers = this.forum.peers.list({ exclude: this.peerId, limit: 50 });
    for (const peer of peers) {
      const address = this.dialTarget(peer.multiaddrs);
      if (!address) continue;
      try {
        await this.rpc(multiaddr(address), PFP_PROTOCOLS.networks, {
          type: 'PushOps',
          networkId,
          ops,
        });
      } catch {
        /* best-effort push */
      }
    }
  }

  /** One sync pass over a batch of known peers. */
  async syncRound(): Promise<SyncReport[]> {
    const reports: SyncReport[] = [];
    reports.push(...(await this.syncPublic()));

    for (const summary of this.forum.listNetworks()) {
      if (!summary.myRole) continue;
      reports.push(...(await this.syncNetwork(summary.networkId)));
    }
    return reports;
  }

  private async syncPublic(): Promise<SyncReport[]> {
    const peers = this.forum.peers.list({
      exclude: this.peerId,
      limit: this.config.peerBatchSize,
    });
    const reports: SyncReport[] = [];
    for (const peer of peers) {
      const address = this.dialTarget(peer.multiaddrs);
      if (!address) continue;
      try {
        reports.push(await this.syncWithPeer(address));
        await this.discoverFromPeer(address);
      } catch {
        this.forum.peers.recordFail(peer.peerId);
      }
    }
    return reports;
  }

  private async syncNetwork(networkId: string): Promise<SyncReport[]> {
    const peers = this.forum.peers.list({
      exclude: this.peerId,
      limit: this.config.peerBatchSize,
    });
    const reports: SyncReport[] = [];
    for (const peer of peers) {
      const address = this.dialTarget(peer.multiaddrs);
      if (!address) continue;
      try {
        reports.push(await this.syncWithPeer(address, networkId));
      } catch {
        this.forum.peers.recordFail(peer.peerId);
      }
    }
    return reports;
  }

  /** Connects to a peer and records its address. */
  async addPeer(address: string): Promise<string> {
    if (this.anonymous && !isOnionString(address)) {
      throw new Error('anonymous mode only accepts .onion peer addresses');
    }
    const connection = await this.libp2p.dial(multiaddr(address));
    const peerId = connection.remotePeer.toString();
    this.forum.peers.upsert(peerId, [address]);
    return peerId;
  }

  private startSyncLoop(): void {
    const run = (): void => {
      void this.syncRound().catch(() => undefined);
    };
    this.syncTimer = setInterval(run, this.config.syncIntervalMs);
    this.syncTimer.unref?.();
    const kickoff = setTimeout(run, 1000);
    kickoff.unref?.();
  }
}
