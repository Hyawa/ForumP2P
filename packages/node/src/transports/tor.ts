/**
 * Tor dial transport for libp2p v3.
 *
 * There is no maintained Tor transport for libp2p v3, so this module implements
 * the minimal piece we need: a **dial-only** transport that opens a SOCKS5
 * connection through a local Tor daemon (Arti or `tor`) and speaks libp2p over
 * it. Peers are addressed by `.onion` multiaddrs, so neither side ever learns
 * the other's real IP.
 *
 * Inbound traffic is handled by a Tor `HiddenService` that forwards the onion
 * virtual port to the node's loopback TCP listener (see `config.ts` / `cli.ts`);
 * that is why `listenFilter` is empty and `createListener` is unsupported here.
 *
 * The socket plumbing mirrors `@libp2p/tcp` (see `socket-to-conn.js`) so the
 * rest of the stack (Noise, yamux, identify) works unchanged.
 */
import {
  AbortError,
  InvalidParametersError,
  TimeoutError,
  serviceCapabilities,
  transportSymbol,
  type AbortOptions,
  type ComponentLogger,
  type Connection,
  type CreateListenerOptions,
  type DialTransportOptions,
  type Listener,
  type Logger,
  type MultiaddrFilter,
  type OutboundConnectionUpgradeEvents,
  type Transport,
} from '@libp2p/interface';
import { AbstractMultiaddrConnection } from '@libp2p/utils';
import type { Multiaddr } from '@multiformats/multiaddr';
import net from 'node:net';
import { SocksClient } from 'socks';
import type { Uint8ArrayList } from 'uint8arraylist';

const DEFAULT_INACTIVITY_TIMEOUT = 2 * 60 * 1_000;

/** True for `/onion/<...>` (v2) and `/onion3/<...>` (v3) multiaddrs. */
export function isOnionMultiaddr(ma: Multiaddr): boolean {
  return ma.getComponents().some((component) => component.name === 'onion3' || component.name === 'onion');
}

/** Extracts the `.onion` hostname and port a multiaddr points at. */
export function onionTarget(ma: Multiaddr): { host: string; port: number } {
  let onion: string | undefined;
  let port: number | undefined;
  for (const component of ma.getComponents()) {
    if (component.name === 'onion3' || component.name === 'onion') onion = component.value;
    else if (component.name === 'tcp') port = Number(component.value);
  }
  if (onion === undefined || port === undefined || Number.isNaN(port)) {
    throw new InvalidParametersError(`Not a dialable onion multiaddr: ${ma}`);
  }
  return { host: `${onion}.onion`, port };
}

interface TorConnectionInit {
  socket: net.Socket;
  remoteAddr: Multiaddr;
  direction: 'inbound' | 'outbound';
  log: Logger;
  inactivityTimeout?: number;
}

class TorMultiaddrConnection extends AbstractMultiaddrConnection {
  private readonly socket: net.Socket;

  constructor(init: TorConnectionInit) {
    const timeout = init.inactivityTimeout ?? DEFAULT_INACTIVITY_TIMEOUT;
    super({
      remoteAddr: init.remoteAddr,
      direction: init.direction,
      log: init.log,
      inactivityTimeout: timeout,
    });

    this.socket = init.socket;

    this.socket.on('data', (buf) => {
      this.onData(buf);
    });
    this.socket.on('error', (err) => {
      this.log('tor socket error', init.remoteAddr, err);
      this.abort(err);
    });
    this.socket.setTimeout(timeout);
    this.socket.once('timeout', () => {
      this.log('tor socket timeout', init.remoteAddr);
      this.abort(new TimeoutError());
    });
    this.socket.once('end', () => {
      this.onTransportClosed();
    });
    this.socket.once('close', (hadError) => {
      if (hadError) {
        this.abort(new Error('Tor transmission error'));
        return;
      }
      this.onTransportClosed();
    });
    this.socket.on('drain', () => {
      this.safeDispatchEvent('drain');
    });
  }

  sendData(data: Uint8ArrayList): { sentBytes: number; canSendMore: boolean } {
    let sentBytes = 0;
    let canSendMore = true;
    for (const buf of data) {
      sentBytes += buf.byteLength;
      canSendMore = this.socket.write(buf);
      if (!canSendMore) break;
    }
    return { sentBytes, canSendMore };
  }

  async sendClose(options?: AbortOptions): Promise<void> {
    if (this.socket.destroyed) return;
    this.socket.destroySoon();
    await new Promise<void>((resolve, reject) => {
      const onClose = (): void => {
        options?.signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = (): void => {
        this.socket.removeListener('close', onClose);
        reject(new AbortError());
      };
      if (options?.signal?.aborted === true) {
        onAbort();
        return;
      }
      options?.signal?.addEventListener('abort', onAbort, { once: true });
      this.socket.once('close', onClose);
    });
  }

  sendReset(): void {
    this.socket.destroy();
  }

  sendPause(): void {
    this.socket.pause();
  }

  sendResume(): void {
    this.socket.resume();
  }
}

export interface TorTransportInit {
  /** Local Tor SOCKS5 proxy host (default 127.0.0.1). */
  socksHost?: string;
  /** Local Tor SOCKS5 proxy port (default 9050). */
  socksPort?: number;
  /** SOCKS connect timeout in ms. */
  timeout?: number;
  /** Socket inactivity timeout in ms. */
  inactivityTimeout?: number;
}

export interface TorTransportComponents {
  logger: ComponentLogger;
}

export class TorTransport implements Transport<OutboundConnectionUpgradeEvents> {
  readonly [transportSymbol] = true;
  readonly [Symbol.toStringTag] = '@pforum/tor';
  readonly [serviceCapabilities] = ['@libp2p/transport'];

  private readonly log: Logger;
  private readonly socksHost: string;
  private readonly socksPort: number;
  private readonly timeout: number;
  private readonly inactivityTimeout?: number;

  constructor(components: TorTransportComponents, options: TorTransportInit = {}) {
    this.log = components.logger.forComponent('pforum:tor');
    this.socksHost = options.socksHost ?? '127.0.0.1';
    this.socksPort = options.socksPort ?? 9050;
    this.timeout = options.timeout ?? 30_000;
    this.inactivityTimeout = options.inactivityTimeout;
  }

  async dial(ma: Multiaddr, options: DialTransportOptions): Promise<Connection> {
    const { host, port } = onionTarget(ma);
    options.signal.throwIfAborted();
    const socket = await this.connect(host, port, options.signal);
    let maConn: TorMultiaddrConnection;
    try {
      maConn = new TorMultiaddrConnection({
        socket,
        remoteAddr: ma,
        direction: 'outbound',
        log: this.log.newScope('connection'),
        inactivityTimeout: this.inactivityTimeout,
      });
    } catch (err) {
      socket.destroy();
      throw err;
    }
    try {
      return await options.upgrader.upgradeOutbound(maConn, options);
    } catch (err) {
      this.log.error('error upgrading outbound Tor connection - %e', err);
      maConn.abort(err as Error);
      throw err;
    }
  }

  private connect(host: string, port: number, signal: AbortSignal): Promise<net.Socket> {
    return new Promise<net.Socket>((resolve, reject) => {
      let settled = false;
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        reject(new AbortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });

      this.log('dialing %s via Tor SOCKS %s:%d', host, this.socksHost, this.socksPort);
      SocksClient.createConnection({
        command: 'connect',
        proxy: { host: this.socksHost, port: this.socksPort, type: 5 },
        destination: { host, port },
        timeout: this.timeout,
      })
        .then((info) => {
          if (settled) {
            info.socket.destroy();
            return;
          }
          settled = true;
          signal.removeEventListener('abort', onAbort);
          info.socket.setNoDelay(true);
          resolve(info.socket);
        })
        .catch((err: Error) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          reject(err);
        });
    });
  }

  createListener(_options: CreateListenerOptions): Listener {
    throw new Error(
      'The Tor transport does not listen directly. Run a Tor HiddenService that ' +
        'forwards to the libp2p TCP port and pass its address with --onion.',
    );
  }

  listenFilter: MultiaddrFilter = () => [];

  dialFilter: MultiaddrFilter = (multiaddrs) => multiaddrs.filter(isOnionMultiaddr);
}

/** libp2p transport factory that dials `.onion` peers through a local Tor SOCKS5 proxy. */
export function torDialer(init: TorTransportInit = {}) {
  return (components: TorTransportComponents): Transport => new TorTransport(components, init);
}
