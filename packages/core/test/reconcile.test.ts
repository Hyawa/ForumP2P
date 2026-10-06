import { describe, expect, it } from 'vitest';

import { reconcile } from '../src/reconcile';

describe('reconcile', () => {
  const graph = new Map<string, string | null>([
    ['root', null],
    ['a', 'root'],
    ['b', 'root'],
    ['c', 'a'],
  ]);

  it('sends everything the remote cannot reach from its leaves', () => {
    const { toSend, askBack } = reconcile(graph, ['b']);
    expect(new Set(toSend)).toEqual(new Set(['a', 'c']));
    expect(askBack).toBe(false);
  });

  it('sends nothing when the remote already has the full ancestry', () => {
    const { toSend } = reconcile(graph, ['b', 'c']);
    expect(toSend).toEqual([]);
  });

  it('flags askBack when the remote advertises unknown leaves', () => {
    const { toSend, askBack } = reconcile(graph, ['unknown']);
    expect(askBack).toBe(true);
    expect(new Set(toSend)).toEqual(new Set(['root', 'a', 'b', 'c']));
  });

  it('sends the whole topic to a fresh peer', () => {
    const { toSend } = reconcile(graph, []);
    expect(toSend).toHaveLength(4);
  });
});
