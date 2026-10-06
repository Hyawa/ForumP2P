import { describe, expect, it } from 'vitest';

import {
  canonicalize,
  contentId,
  createArticle,
  decodeMessage,
  encodeMessage,
  FrameDecoder,
  frame,
  generateKeyPair,
  topicSnapshot,
  verifyArticle,
} from '../src/index';

describe('canonicalization', () => {
  it('sorts object keys deterministically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('preserves array order but recurses', () => {
    expect(canonicalize([{ z: 1 }, { a: 2 }])).toBe('[{"z":1},{"a":2}]');
  });

  it('omits undefined object properties, nulls undefined array items', () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalize([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('content id is order independent', () => {
    expect(contentId({ x: 1, y: 2 })).toBe(contentId({ y: 2, x: 1 }));
  });
});

describe('article signing', () => {
  it('creates a verifiable article', async () => {
    const keys = await generateKeyPair();
    const article = await createArticle({ content: 'hello world' }, keys.publicKey, keys.privateKey);

    expect(article.author).toBe(keys.publicKey);
    expect(article.id).toMatch(/^[0-9a-f]{64}$/);
    expect((await verifyArticle(article)).ok).toBe(true);
  });

  it('rejects tampered content', async () => {
    const keys = await generateKeyPair();
    const article = await createArticle({ content: 'original' }, keys.publicKey, keys.privateKey);
    const tampered = { ...article, content: 'tampered' };

    const result = await verifyArticle(tampered);
    expect(result.ok).toBe(false);
  });

  it('rejects a signature from another author', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const article = await createArticle({ content: 'from alice' }, alice.publicKey, alice.privateKey);
    const forged = { ...article, author: bob.publicKey };

    expect((await verifyArticle(forged)).ok).toBe(false);
  });
});

describe('topic snapshot', () => {
  it('is independent of insertion order', () => {
    expect(topicSnapshot(['a', 'b', 'c'])).toBe(topicSnapshot(['c', 'a', 'b']));
  });

  it('changes when contents change', () => {
    expect(topicSnapshot(['a', 'b'])).not.toBe(topicSnapshot(['a', 'b', 'c']));
  });
});

describe('wire codec', () => {
  it('round-trips a message', () => {
    const bytes = encodeMessage({ type: 'GetPeers' });
    expect(decodeMessage(bytes)).toEqual({ type: 'GetPeers' });
  });

  it('round-trips through framing', () => {
    const decoder = new FrameDecoder();
    const messages = [
      encodeMessage({ type: 'GetTopicHeads', since: null, until: 100, networkId: null }),
      encodeMessage({ type: 'GetPosts', topicId: 'a'.repeat(64), have: [], networkId: null }),
    ];
    const stream = new Uint8Array(messages.reduce((n, m) => n + m.length + 4, 0));
    let offset = 0;
    for (const message of messages) {
      const framed = frame(message);
      stream.set(framed, offset);
      offset += framed.length;
    }

    const decoded = decoder.push(stream).map((payload) => decodeMessage(payload));
    expect(decoded).toEqual([
      { type: 'GetTopicHeads', since: null, until: 100, networkId: null },
      { type: 'GetPosts', topicId: 'a'.repeat(64), have: [], networkId: null },
    ]);
  });

  it('reassembles frames split across chunks', () => {
    const decoder = new FrameDecoder();
    const framed = frame(encodeMessage({ type: 'GetPeers' }));
    const half = Math.floor(framed.length / 2);
    expect(decoder.push(framed.subarray(0, half))).toHaveLength(0);
    const frames = decoder.push(framed.subarray(half));
    expect(frames).toHaveLength(1);
    expect(decodeMessage(frames[0]!)).toEqual({ type: 'GetPeers' });
  });
});
