/**
 * Topic set reconciliation.
 *
 * This is the direct descendant of PeerForum's `Topic.ChkByLeaves`. A topic is
 * a tree/DAG of content-addressed articles. To find out what a remote peer is
 * missing we:
 *
 *  1. take the remote's leaf ids (articles it believes have no children) as a
 *     compact summary of what it already has;
 *  2. walk each leaf's ancestry in *our* graph to reconstruct the set it can
 *     already reach;
 *  3. send it everything else.
 *
 * If the remote lists leaves we have never seen, it holds content we lack and
 * we flag `askBack` so the caller can schedule a pull from it.
 */

export interface ReconcileResult {
  /** Article ids the remote is missing. */
  toSend: string[];
  /** True when the remote advertises leaves unknown to us (we should pull). */
  askBack: boolean;
}

/**
 * @param localGraph map of article id -> parent id (null for the root)
 * @param remoteLeaves leaf ids advertised by the remote
 */
export function reconcile(
  localGraph: ReadonlyMap<string, string | null>,
  remoteLeaves: Iterable<string>,
): ReconcileResult {
  const remoteKnown = new Set<string>();
  let askBack = false;

  for (const leaf of remoteLeaves) {
    if (!localGraph.has(leaf)) {
      askBack = true;
      continue;
    }
    let current: string | null | undefined = leaf;
    while (current && !remoteKnown.has(current)) {
      remoteKnown.add(current);
      current = localGraph.get(current) ?? null;
    }
  }

  const toSend: string[] = [];
  for (const id of localGraph.keys()) {
    if (!remoteKnown.has(id)) toSend.push(id);
  }

  return { toSend, askBack };
}
