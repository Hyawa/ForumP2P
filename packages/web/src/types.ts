import type { SignedArticle } from '@pforum/protocol';

export interface Topic {
  rootId: string;
  title: string;
  labels: string[];
  count: number;
  status: number;
  lastTime: number;
  snapshot: string;
  networkId: string | null;
}

export interface Peer {
  peerId: string;
  multiaddrs: string[];
  level: number;
  failCount: number;
  lastSeen: number;
  blocked: boolean;
}

export interface NodeStatus {
  peerId: string;
  user: string;
  multiaddrs: string[];
  peers: number;
  topics: number;
  networks: number;
}

export interface TopicDetail {
  topic: Topic;
  articles: SignedArticle[];
}

export type Article = SignedArticle;

export type NetworkRole = 'owner' | 'admin' | 'member';

export interface NetworkSummary {
  networkId: string;
  name: string;
  owner: string;
  salt: string;
  createdAt: number;
  myRole: NetworkRole | null;
  memberCount: number;
}

export interface MemberState {
  user: string;
  role: NetworkRole;
  active: boolean;
  epoch: number;
}

export interface NetworkView {
  network: {
    networkId: string;
    name: string;
    owner: string;
    salt: string;
    createdAt: number;
  };
  myRole: NetworkRole | null;
  members: MemberState[];
}
