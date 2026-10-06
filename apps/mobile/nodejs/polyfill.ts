/**
 * Runtime shims for the mobile Node.js runtime (Node 18.20.x).
 *
 * libp2p v3 and Fastify 5 use `Promise.withResolvers`, which only exists on
 * Node 22+. This must run **before** those modules are evaluated, so it is the
 * first import of the mobile entry (and esbuild's banner injects it too).
 */
type Resolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

// WebCrypto (`crypto.subtle`) is only a global from Node 19. `@noble/ed25519`
// needs it for SHA-512; expose Node's implementation globally on Node 18.
import { webcrypto } from 'node:crypto';

if (typeof (globalThis as { crypto?: unknown }).crypto === 'undefined') {
  (globalThis as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
}

// `CustomEvent` / `navigator` are Node 19+/21 globals that libp2p relies on.
if (typeof (globalThis as { CustomEvent?: unknown }).CustomEvent === 'undefined') {
  class CustomEventShim<T> extends Event {
    readonly detail: T | undefined;
    constructor(type: string, init?: { detail?: T }) {
      super(type);
      this.detail = init?.detail;
    }
  }
  (globalThis as { CustomEvent: typeof CustomEvent }).CustomEvent =
    CustomEventShim as unknown as typeof CustomEvent;
}

if (typeof (globalThis as { navigator?: unknown }).navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'pforum' },
    configurable: true,
  });
}

if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
  (Promise as unknown as { withResolvers: <T>() => Resolvers<T> }).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
