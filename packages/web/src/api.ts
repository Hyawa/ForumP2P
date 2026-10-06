import type {
  Article,
  NetworkSummary,
  NetworkView,
  NodeStatus,
  Peer,
  Topic,
  TopicDetail,
} from './types';

/** The local daemon API. Override with VITE_API_URL for a remote daemon. */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:7331';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export interface NetworksResponse {
  networks: NetworkSummary[];
}

export const api = {
  status: () => request<NodeStatus>('/status'),
  topics: (networkId?: string | null) => {
    const query = networkId === undefined ? '' : `?network=${networkId === null ? 'public' : networkId}`;
    return request<{ topics: Topic[] }>(`/topics${query}`);
  },
  topic: (id: string) => request<TopicDetail>(`/topics/${id}`),
  createTopic: (content: string, labels: string[], networkId: string | null = null) =>
    request<{ topic: Topic; article: Article }>('/topics', {
      method: 'POST',
      body: JSON.stringify({ content, labels, networkId }),
    }),
  reply: (id: string, content: string) =>
    request<{ article: Article }>(`/topics/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  peers: () => request<{ peers: Peer[] }>('/peers'),
  addPeer: (address: string) =>
    request<{ peerId: string }>('/peers', { method: 'POST', body: JSON.stringify({ address }) }),
  sync: () => request<{ reports: unknown[] }>('/sync', { method: 'POST' }),

  networks: () => request<NetworksResponse>('/networks'),
  createNetwork: (name: string) =>
    request<{ network: NetworkSummary }>('/networks', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  network: (id: string) => request<NetworkView>(`/networks/${id}`),
  createInvite: (id: string, options: { expiresInMs?: number; maxUses?: number }) =>
    request<{ code: string }>(`/networks/${id}/invites`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),
  joinNetwork: (code: string) =>
    request<{ network: NetworkSummary }>('/networks/join', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  removeMember: (id: string, pubkey: string) =>
    request<{ ok: boolean }>(`/networks/${id}/members/${pubkey}`, { method: 'DELETE' }),
};

/** Subscribes to live article events. Returns an unsubscribe function. */
export function subscribeArticles(onArticle: (article: Article) => void): () => void {
  const source = new EventSource(`${API_BASE}/events`);
  source.onmessage = (event) => {
    try {
      onArticle(JSON.parse(event.data) as Article);
    } catch {
      /* ignore malformed events */
    }
  };
  return () => source.close();
}
