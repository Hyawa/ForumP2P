import type {
  Article,
  NetworkSummary,
  NetworkView,
  NodeStatus,
  Peer,
  Topic,
  TopicDetail,
} from './types';

/**
 * The daemon API base URL.
 *
 * Resolution order:
 *  1. `window.__PF_API__` — injected at runtime by the Electron / Capacitor shell
 *  2. `VITE_API_URL` — baked in at build time (e.g. a remote daemon)
 *  3. the local daemon default
 */
function runtimeApiBase(): string | undefined {
  const value = (globalThis as { __PF_API__?: unknown }).__PF_API__;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function runtimeToken(): string | undefined {
  const value = (globalThis as { __PF_TOKEN__?: unknown }).__PF_TOKEN__;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const API_BASE =
  runtimeApiBase() ?? (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:7331';

const API_TOKEN = runtimeToken();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches with retry on network errors. On mobile the local node boots
 * asynchronously, so the first requests can fail while it is still starting;
 * idempotent (GET) requests are retried, mutations are not.
 */
async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const retryable = method === 'GET' || method === 'HEAD';
  const attempts = retryable ? 6 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(400 + attempt * 300);
    }
  }
  throw lastError;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`;
  let response: Response;
  try {
    response = await fetchWithRetry(`${API_BASE}${path}`, { headers, ...init });
  } catch {
    throw new Error(
      `Não foi possível falar com o nó local (${API_BASE}). Se for mobile, o nó pode ainda estar iniciando.`,
    );
  }
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
  // EventSource cannot set headers, so a token is passed as a query param.
  const url = API_TOKEN
    ? `${API_BASE}/events?token=${encodeURIComponent(API_TOKEN)}`
    : `${API_BASE}/events`;
  const source = new EventSource(url);
  source.onmessage = (event) => {
    try {
      onArticle(JSON.parse(event.data) as Article);
    } catch {
      /* ignore malformed events */
    }
  };
  return () => source.close();
}
