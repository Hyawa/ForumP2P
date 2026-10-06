import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';

import { api, subscribeArticles } from './api';
import { copyText } from './clipboard';
import type { Article, NetworkRole, NetworkSummary, NetworkView, NodeStatus, Peer, Topic } from './types';

function shortKey(hex: string): string {
  return hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Button that copies text and shows a short "Copied!" confirmation. */
function CopyButton(props: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    const ok = await copyText(props.text);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button className={props.className ?? 'secondary'} onClick={() => void onClick()}>
      {copied ? 'Copiado!' : (props.label ?? 'Copiar')}
    </button>
  );
}

type View = { name: 'topics' } | { name: 'topic'; id: string } | { name: 'peers' } | { name: 'networks' } | { name: 'network'; id: string };
type NetworkFilter = 'all' | 'public' | string;

function filterToParam(filter: NetworkFilter): string | null | undefined {
  if (filter === 'all') return undefined;
  if (filter === 'public') return null;
  return filter;
}

export function App() {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [networks, setNetworks] = useState<NetworkSummary[]>([]);
  const [view, setView] = useState<View>({ name: 'topics' });
  const [filter, setFilter] = useState<NetworkFilter>('all');
  const [detail, setDetail] = useState<{ topic: Topic; articles: Article[] } | null>(null);
  const [networkView, setNetworkView] = useState<NetworkView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const refreshTopics = useCallback(
    async (which: NetworkFilter = filter) => {
      try {
        setTopics((await api.topics(filterToParam(which))).topics);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [filter],
  );

  const refreshPeers = useCallback(async () => {
    try {
      setPeers((await api.peers()).peers);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const refreshNetworks = useCallback(async () => {
    try {
      setNetworks((await api.networks()).networks);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const openTopic = useCallback(async (id: string) => {
    setView({ name: 'topic', id });
    setDetail(null);
    try {
      setDetail(await api.topic(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const openNetwork = useCallback(async (id: string) => {
    setView({ name: 'network', id });
    setNetworkView(null);
    try {
      setNetworkView(await api.network(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshTopics('all');
    void refreshPeers();
    void refreshNetworks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshTopics(filter);
  }, [filter, refreshTopics]);

  useEffect(() => {
    return subscribeArticles(() => {
      void refreshTopics();
      void refreshStatus();
      void refreshNetworks();
      if (view.name === 'topic') void openTopic(view.id);
      if (view.name === 'network') void openNetwork(view.id);
    });
  }, [refreshTopics, refreshStatus, refreshNetworks, openTopic, openNetwork, view]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span> PeerForum
          <span className="tagline">serverless · p2p · signed</span>
        </div>
        <nav className="tabs">
          <button className={view.name === 'topics' || view.name === 'topic' ? 'active' : ''} onClick={() => setView({ name: 'topics' })}>
            Topics
          </button>
          <button
            className={view.name === 'networks' || view.name === 'network' ? 'active' : ''}
            onClick={() => {
              setView({ name: 'networks' });
              void refreshNetworks();
            }}
          >
            Networks {status ? `(${status.networks})` : ''}
          </button>
          <button
            className={view.name === 'peers' ? 'active' : ''}
            onClick={() => {
              setView({ name: 'peers' });
              void refreshPeers();
            }}
          >
            Peers {status ? `(${status.peers})` : ''}
          </button>
        </nav>
        {status && (
          <div className="identity" title={`${status.peerId}\n${status.user}`}>
            <div>
              <span className="mono">{shortKey(status.peerId)}</span>
              <span className="dim"> node</span>
            </div>
            <div>
              <span className="mono">{shortKey(status.user)}</span>
              <span className="dim"> you</span>
            </div>
          </div>
        )}
      </header>

      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <main className="content">
        {view.name === 'topics' && (
          <TopicsView
            topics={topics}
            networks={networks}
            filter={filter}
            busy={busy}
            onFilterChange={setFilter}
            onOpen={openTopic}
            onCreate={(content, labels, networkId) =>
              run(async () => {
                const created = await api.createTopic(content, labels, networkId);
                await refreshTopics();
                await refreshStatus();
                await openTopic(created.topic.rootId);
              })
            }
          />
        )}

        {view.name === 'topic' && detail && (
          <TopicView
            detail={detail}
            busy={busy}
            onBack={() => setView({ name: 'topics' })}
            onReply={(content) =>
              run(async () => {
                await api.reply(detail.topic.rootId, content);
                await openTopic(detail.topic.rootId);
                await refreshTopics();
              })
            }
          />
        )}
        {view.name === 'topic' && !detail && <div className="muted">loading topic…</div>}

        {view.name === 'networks' && (
          <NetworksView
            networks={networks}
            busy={busy}
            onOpen={openNetwork}
            onCreate={(name) =>
              run(async () => {
                const created = await api.createNetwork(name);
                await refreshNetworks();
                await refreshStatus();
                await openNetwork(created.network.networkId);
              })
            }
            onJoin={(code) =>
              run(async () => {
                const joined = await api.joinNetwork(code);
                await refreshNetworks();
                await refreshStatus();
                await openNetwork(joined.network.networkId);
              })
            }
          />
        )}

        {view.name === 'network' && networkView && (
          <NetworkDetailView
            view={networkView}
            busy={busy}
            onBack={() => setView({ name: 'networks' })}
            onInvite={(options) => api.createInvite(networkView.network.networkId, options)}
            onRemove={(pubkey) =>
              run(async () => {
                await api.removeMember(networkView.network.networkId, pubkey);
                await openNetwork(networkView.network.networkId);
                await refreshNetworks();
              })
            }
            onViewTopics={() => {
              setFilter(networkView.network.networkId);
              setView({ name: 'topics' });
            }}
          />
        )}
        {view.name === 'network' && !networkView && <div className="muted">loading network…</div>}

        {view.name === 'peers' && (
          <PeersView
            peers={peers}
            myAddrs={status?.multiaddrs ?? []}
            busy={busy}
            onAdd={(address) =>
              run(async () => {
                await api.addPeer(address);
                await refreshPeers();
                await refreshStatus();
              })
            }
            onSync={() =>
              run(async () => {
                await api.sync();
                await refreshPeers();
                await refreshTopics();
                await refreshStatus();
              })
            }
          />
        )}
      </main>
    </div>
  );
}

function TopicsView(props: {
  topics: Topic[];
  networks: NetworkSummary[];
  filter: NetworkFilter;
  busy: boolean;
  onFilterChange: (filter: NetworkFilter) => void;
  onOpen: (id: string) => void;
  onCreate: (content: string, labels: string[], networkId: string | null) => void;
}) {
  const [content, setContent] = useState('');
  const [labels, setLabels] = useState('');

  const networkId = props.filter !== 'all' && props.filter !== 'public' ? props.filter : null;
  const networkName = networkId ? props.networks.find((n) => n.networkId === networkId)?.name : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim()) return;
    const parsed = labels
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);
    props.onCreate(content.trim(), parsed, networkId);
    setContent('');
    setLabels('');
  };

  return (
    <div className="two-col">
      <section>
        <div className="row-between">
          <h2>Topics</h2>
          <select value={props.filter} onChange={(event) => props.onFilterChange(event.target.value)}>
            <option value="all">All content</option>
            <option value="public">Public (not in a network)</option>
            {props.networks.map((network) => (
              <option key={network.networkId} value={network.networkId}>
                🔒 {network.name}
              </option>
            ))}
          </select>
        </div>
        {props.topics.length === 0 && (
          <p className="muted">
            No topics {networkName ? `in “${networkName}”` : 'yet'}. Create one, or add a peer and sync.
          </p>
        )}
        <ul className="topic-list">
          {props.topics.map((topic) => (
            <li key={topic.rootId} onClick={() => props.onOpen(topic.rootId)}>
              <div className="topic-title">
                {topic.networkId && <span className="lock" title="network post">🔒 </span>}
                {topic.title || '(empty)'}
              </div>
              <div className="topic-meta">
                <span className="pill">{topic.count} posts</span>
                {topic.labels.map((label) => (
                  <span className="pill label" key={label}>
                    #{label}
                  </span>
                ))}
                <span className="dim">{formatTime(topic.lastTime)}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <aside>
        <h2>New topic{networkName ? ` in ${networkName}` : ''}</h2>
        <form onSubmit={submit} className="card">
          <textarea
            placeholder="First line is the title. Write more lines for the body…"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={6}
          />
          <input
            placeholder="labels, comma, separated"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
          />
          <button type="submit" disabled={props.busy}>
            Publish (signed)
          </button>
        </form>
      </aside>
    </div>
  );
}

function buildChildren(articles: Article[]): Map<string | null, Article[]> {
  const byParent = new Map<string | null, Article[]>();
  for (const article of articles) {
    const key = article.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(article);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.createTime - b.createTime);
  }
  return byParent;
}

function ArticleNode(props: { article: Article; byParent: Map<string | null, Article[]>; depth: number }) {
  const children = props.byParent.get(props.article.id) ?? [];
  const root = props.article.parentId === null;
  return (
    <div className="article" style={{ marginLeft: props.depth * 18 }}>
      <div className={root ? 'article-body root' : 'article-body'}>
        <pre className="article-text">{props.article.content}</pre>
        <div className="article-meta">
          <span className="mono">{shortKey(props.article.author)}</span>
          <span className="dim">{formatTime(props.article.createTime)}</span>
        </div>
      </div>
      {children.map((child) => (
        <ArticleNode key={child.id} article={child} byParent={props.byParent} depth={props.depth + 1} />
      ))}
    </div>
  );
}

function TopicView(props: {
  detail: { topic: Topic; articles: Article[] };
  busy: boolean;
  onBack: () => void;
  onReply: (content: string) => void;
}) {
  const [content, setContent] = useState('');
  const byParent = buildChildren(props.detail.articles);
  const roots = byParent.get(null) ?? [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim()) return;
    props.onReply(content.trim());
    setContent('');
  };

  return (
    <div className="topic-view">
      <button className="link" onClick={props.onBack}>
        ← Topics
      </button>
      <h2>
        {props.detail.topic.networkId && <span className="lock">🔒 </span>}
        {props.detail.topic.title || '(empty)'}
      </h2>
      {roots.map((root) => (
        <ArticleNode key={root.id} article={root} byParent={byParent} depth={0} />
      ))}
      <form onSubmit={submit} className="card reply">
        <textarea
          placeholder="Write a reply… (signed with your key)"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
        />
        <button type="submit" disabled={props.busy}>
          Reply
        </button>
      </form>
    </div>
  );
}

const ROLE_LABEL: Record<NetworkRole, string> = {
  owner: 'owner',
  admin: 'admin',
  member: 'member',
};

function NetworksView(props: {
  networks: NetworkSummary[];
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onJoin: (code: string) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    props.onCreate(name.trim());
    setName('');
  };
  const join = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    props.onJoin(code.trim());
    setCode('');
  };

  return (
    <div className="two-col">
      <section>
        <h2>Your networks</h2>
        {props.networks.length === 0 && (
          <p className="muted">No networks yet. Create one, or join with an invite code.</p>
        )}
        <ul className="topic-list">
          {props.networks.map((network) => (
            <li key={network.networkId} onClick={() => props.onOpen(network.networkId)}>
              <div className="topic-title">🔒 {network.name}</div>
              <div className="topic-meta">
                <span className="pill role-{network.myRole ?? 'none'}">{network.myRole ?? 'not a member'}</span>
                <span className="pill">{network.memberCount} members</span>
                <span className="dim mono">{shortKey(network.networkId)}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <aside>
        <h2>Create a network</h2>
        <form onSubmit={create} className="card">
          <input placeholder="Network name" value={name} onChange={(event) => setName(event.target.value)} />
          <button type="submit" disabled={props.busy}>
            Create
          </button>
        </form>

        <h2>Join with a code</h2>
        <form onSubmit={join} className="card">
          <textarea
            placeholder="Paste an invite code (PFPJOIN1.…) or scan the QR"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            rows={4}
          />
          <button type="submit" disabled={props.busy}>
            Join
          </button>
        </form>
      </aside>
    </div>
  );
}

function NetworkDetailView(props: {
  view: NetworkView;
  busy: boolean;
  onBack: () => void;
  onInvite: (options: { expiresInMs?: number; maxUses?: number }) => Promise<{ code: string }>;
  onRemove: (pubkey: string) => void;
  onViewTopics: () => void;
}) {
  const [ttl, setTtl] = useState(24 * 60 * 60 * 1000);
  const [maxUses, setMaxUses] = useState(1);
  const [invite, setInvite] = useState<{ code: string; qr: string } | null>(null);
  const [working, setWorking] = useState(false);

  const canManage = props.view.myRole === 'owner' || props.view.myRole === 'admin';
  const isOwner = props.view.myRole === 'owner';

  const generate = async () => {
    setWorking(true);
    try {
      const { code } = await props.onInvite({ expiresInMs: ttl, maxUses });
      const qr = await QRCode.toDataURL(code, { margin: 1, width: 240 });
      setInvite({ code, qr });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="network-view">
      <button className="link" onClick={props.onBack}>
        ← Networks
      </button>
      <div className="row-between">
        <h2>🔒 {props.view.network.name}</h2>
        <button className="secondary" onClick={props.onViewTopics}>
          View topics in this network
        </button>
      </div>
      <div className="topic-meta">
        <span className="pill">{props.view.myRole ?? 'not a member'}</span>
        <span className="dim mono">{props.view.network.networkId}</span>
      </div>

      <h2>Members ({props.view.members.filter((m) => m.active).length})</h2>
      <ul className="peer-list">
        {props.view.members.map((member) => (
          <li key={member.user}>
            <div className="row-between">
              <span className="mono">
                {shortKey(member.user)}
                {!member.active && <span className="dim"> (removed)</span>}
              </span>
              <span className="pill">{ROLE_LABEL[member.role]}</span>
              {canManage && member.active && member.role !== 'owner' && (
                <button className="secondary small-btn" onClick={() => props.onRemove(member.user)}>
                  Remove
                </button>
              )}
              {isOwner && member.active && member.role === 'admin' && (
                <span className="dim small">(admin)</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {canManage && (
        <>
          <h2>Invite someone</h2>
          <div className="card row">
            <select value={ttl} onChange={(event) => setTtl(Number(event.target.value))}>
              <option value={15 * 60 * 1000}>expires in 15 min</option>
              <option value={60 * 60 * 1000}>expires in 1 hour</option>
              <option value={24 * 60 * 60 * 1000}>expires in 24 hours</option>
              <option value={7 * 24 * 60 * 60 * 1000}>expires in 7 days</option>
            </select>
            <input
              type="number"
              min={1}
              value={maxUses}
              onChange={(event) => setMaxUses(Math.max(1, Number(event.target.value)))}
            />
            <button onClick={() => void generate()} disabled={working || props.busy}>
              Generate code
            </button>
          </div>

          {invite && (
            <div className="card invite">
              <img src={invite.qr} alt="Invite QR code" width={200} height={200} />
              <textarea readOnly value={invite.code} rows={3} onFocus={(event) => event.target.select()} />
              <div className="row">
                <CopyButton text={invite.code} label="Copiar código" />
                <span className="dim small">One-time · expires as selected</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PeersView(props: {
  peers: Peer[];
  myAddrs: string[];
  busy: boolean;
  onAdd: (address: string) => void;
  onSync: () => void;
}) {
  const [address, setAddress] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!address.trim()) return;
    props.onAdd(address.trim());
    setAddress('');
  };

  return (
    <div className="peers-view">
      <h2>Your addresses</h2>
      <ul className="addr-list">
        {props.myAddrs.map((addr) => (
          <li key={addr} className="mono" title="Clique para copiar" onClick={() => void copyText(addr)}>
            {addr}
          </li>
        ))}
      </ul>

      <h2>Add a peer</h2>
      <form onSubmit={submit} className="card row">
        <input
          placeholder="/ip4/1.2.3.4/tcp/4001/p2p/12D3Koo…"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <button type="submit" disabled={props.busy}>
          Connect
        </button>
        <button type="button" className="secondary" disabled={props.busy} onClick={props.onSync}>
          Sync now
        </button>
      </form>

      <h2>Known peers ({props.peers.length})</h2>
      {props.peers.length === 0 && <p className="muted">No peers known yet.</p>}
      <ul className="peer-list">
        {props.peers.map((peer) => (
          <li key={peer.peerId}>
            <div className="mono">{shortKey(peer.peerId)}</div>
            <div className="peer-meta">
              <span className="pill">reputation {peer.level}</span>
              <span className="pill">fails {peer.failCount}</span>
              <span className="dim">{formatTime(peer.lastSeen)}</span>
            </div>
            {peer.multiaddrs.map((addr) => (
              <div key={addr} className="mono dim small">
                {addr}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
